// Actual components rendered offline: no database, network or message actions.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, cache = new Map()) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const requireFile = name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('.') || name.startsWith('@/')) {
      const target = name.startsWith('@/') ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      const resolved = ['.ts', '.tsx'].map(ext => target + ext).find(candidate => fs.existsSync(candidate));
      if (!resolved) throw new Error(`Unexpected dependency ${name}`);
      return load(resolved, mocks, cache);
    }
    return require(name);
  };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Intl, URL, URLSearchParams })(requireFile, module, module.exports);
  cache.set(filename, module.exports); return module.exports;
}
function shell(pathname, platformRole = 'super_admin', scoped = false) {
  const { AppShell } = load('components/layout/AppShell.tsx', {
    'next/navigation': { usePathname: () => pathname, useRouter: () => ({ push() {}, refresh() {} }) },
    '@/lib/store': { AppStoreProvider: ({ children }) => children, useStoreSession: () => ({ isAdmin: platformRole !== 'staff', can: () => true,
      profile: { platformRole }, superAdminFirmScope: scoped ? { id: 'firm-a', name: 'Synthetic firm', firmCode: '1234567890' } : null }) },
    '@/lib/platform/client': { authJson: () => { throw new Error('Network prohibited'); } },
    '@/components/layout/Sidebar': { Sidebar: () => null }, '@/components/layout/Header': { Header: () => null },
  });
  return renderToStaticMarkup(React.createElement(AppShell, null, React.createElement('div', null, 'PRIVATE_CUSTOMER_WORK')));
}
test('global platform routes allow aggregates and account but require an explicit firm for customer work', () => {
  const { requiresFirmWorkspace } = load('lib/workspace-access.ts');
  for (const route of ['/', '/analytics', '/account', '/platform', '/platform/contracts', '/platform/advertising']) assert.equal(requiresFirmWorkspace(route), false);
  for (const route of ['/db', '/cases', '/clients', '/sms', '/changes', '/settlements', '/settlement-settings', '/firm/settings', '/firm/contract-settings', '/cases/private-id']) {
    assert.equal(requiresFirmWorkspace(route), true);
    const html = shell(route); assert.match(html, /관리할 로펌을 선택/); assert.doesNotMatch(html, /PRIVATE_CUSTOMER_WORK/);
  }
  assert.match(shell('/analytics'), /PRIVATE_CUSTOMER_WORK/);
  assert.match(shell('/db', 'super_admin', true), /PRIVATE_CUSTOMER_WORK/);
});
test('firm managers cannot render platform finances and ordinary staff cannot render manager analytics', () => {
  assert.doesNotMatch(shell('/platform/costs', 'firm_admin'), /PRIVATE_CUSTOMER_WORK/);
  assert.doesNotMatch(shell('/platform/settings', 'staff'), /PRIVATE_CUSTOMER_WORK/);
  assert.doesNotMatch(shell('/analytics', 'staff'), /PRIVATE_CUSTOMER_WORK/);
  assert.doesNotMatch(shell('/firm/contract-settings', 'staff'), /PRIVATE_CUSTOMER_WORK/);
  assert.match(shell('/firm/contract-settings', 'firm_admin'), /PRIVATE_CUSTOMER_WORK/);
  assert.match(shell('/db', 'firm_admin'), /PRIVATE_CUSTOMER_WORK/);
  assert.match(shell('/analytics', 'firm_admin'), /PRIVATE_CUSTOMER_WORK/);
});
test('sidebar keeps platform costs and sales away from law-firm accounts', () => {
  function render(platformRole, scoped = false) {
    const { Sidebar } = load('components/layout/Sidebar.tsx', {
      'next/navigation': { usePathname: () => '/analytics', useRouter: () => ({ push() {} }) },
      'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
      '@/components/brand/BrandLogo': { BrandLogo: () => null },
      '@/lib/platform/client': { authJson: () => { throw new Error('Network prohibited'); } },
      '@/lib/store': { useStoreSession: () => ({ profile: { platformRole, displayName: 'Synthetic manager' }, isAdmin: true, can: () => true,
        firmDirectory: [], superAdminFirmScope: scoped ? { id: 'firm-a', name: 'Synthetic firm' } : null }) },
    });
    return renderToStaticMarkup(React.createElement(Sidebar));
  }
  const firm = render('firm_admin');
  assert.match(firm, /로펌 운영/); assert.match(firm, /데이터집계/);
  assert.match(firm, /직원관리/); assert.match(firm, /href="\/firm\/contract-settings"/); assert.match(firm, /계약서 설정/);
  assert.doesNotMatch(firm, /직원계정관리|로펌 설정\/직원초대|href="\/firm\/settings/);
  const scoped = render('super_admin', true);
  assert.match(scoped, /로펌 설정\/광고연동/); assert.match(scoped, /href="\/firm\/settings\?lawFirmId=firm-a"/);
  assert.doesNotMatch(firm, /href="\/platform/); assert.doesNotMatch(firm, /DB 원가|로파워 정산설정|영업 파이프라인/);
  const global = render('super_admin');
  assert.match(global, /로파워 운영/); assert.match(global, /전체 로펌 성과/);
  assert.doesNotMatch(global, /href="\/db"|href="\/cases"|href="\/sms"/);
});
test('firm dashboard shows the server supply denominator separately from contract-date totals for managers only', () => {
  const management = load('lib/management-core.ts');
  const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
  const start = `${y}-${String(m).padStart(2,'0')}-01`, end = `${y}-${String(m).padStart(2,'0')}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`;
  const quality = {unlinkedRows:0,missingLeads:0,duplicateSupplyRows:0,unknownSupplyRows:0,invalidSupplyDates:0,unresolvedContracts:0};
  const cohort = {supplied:20,retained:3,conversionRate:15,excludedSupplyRows:0,quality,staff:[{key:'staff:A',name:'A',kind:'staff',db:20,contractedDb:3,conversionRate:15}]};
  function render(manager) {
    const { default: Dashboard } = load('components/dashboard/FirmDashboard.tsx', {
      'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
      '@/lib/store': { useStore: () => ({ clients: [], cases: [], installments: [], scheduleItems: [], leads: [], isAdmin: manager, currentStaff: 'Synthetic staff', can: () => true,
        profile: { platformRole: manager ? 'firm_admin' : 'staff', role: manager ? 'admin' : 'staff' }, superAdminFirmScope: null, workStaffNames: [], firmDirectory: [] }) },
      '@/lib/management-analytics': { ...management, useManagementSettings: () => ({ globalSuperView: false, effectiveFirmId: 'firm-a', activeSettings: management.DEFAULT_MANAGEMENT_SETTINGS, settingsByFirm: {}, loading: false, error: null }) },
      '@/lib/use-firm-supply': { useFirmSupply: () => ({ data: {start,end,purchaseCost:0,serviceMode:'crm_only',supplyCohort:cohort,matureCohort:{...cohort,cutoff:start}}, loading: false, error: null }) },
      '@/components/ui/DateRangePicker': { DateRangePicker: () => null }, '@/components/charts/MonthCalendar': { MonthCalendar: () => null },
      '@/lib/management-export-client': { recordManagementExport: () => { throw new Error('Writes prohibited'); } },
    });
    return renderToStaticMarkup(React.createElement(Dashboard));
  }
  const manager = render(true);
  assert.match(manager, /월 공급 DB/); assert.match(manager, /수임 3건 \/ 공급 DB 20건 · 수임전환율 15\.0%/);
  assert.match(manager, /전체 수임 · 계약일/); assert.match(manager, /계약일 기준/);
  assert.doesNotMatch(render(false), /월 공급 DB|직원별 공급 DB/);
});
