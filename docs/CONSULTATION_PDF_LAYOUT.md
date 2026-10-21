# Compact A4 consultation PDF

## Behavior

- A4 portrait with 9 mm horizontal margins. Body uses 10 pt embedded NanumGothic, increased from the previous 9 pt body. Field labels, table headings, memo metadata and footers use 9 pt.
- Smaller first-page header, section gaps and row padding reduce paper use without any fit-to-page scaling or omitted fields. Key/value sections retain two label/value pairs per row and omit the redundant `항목 / 내용` header.
- Memo author/time/tag metadata appears in a compact strip above full-width memo text, rather than consuming a permanent side column. Original and draft memos remain separately identified.
- Sections retain their ordering and complete existing data allowlist. Unregistered/unsaved content, Korean text, KST timestamps, explicit zero/false values, calculated results when present, finance when supplied, source filenames, attachment metadata and pinned memo markers are preserved. Attachment contents, URLs and private IDs remain excluded.
- Ordinary rows stay together where practical. Oversized rows, memo text and even unusually long author metadata can span pages; section titles and table headings repeat on continuation pages. Long unbroken Korean and Latin strings are wrapped against actual font widths. No text is shrunk to force a one-page result.
- Existing lazy import, offline `fontData` argument, same-origin cached font load, retry behavior, filename and download cleanup APIs are unchanged. The change does not save a draft, send data to a server or change any database state.

## Measured synthetic fixtures

Compared with repository HEAD `db8f0b7`, using the same bundled font and unchanged content in each fixture:

| Fixture | Previous pages | Compact pages | Content |
| --- | ---: | ---: | --- |
| Short consultation | 2 | 1 | Basic personal/income/housing/debt/plan data and a brief memo |
| Populated consultation | 4 | 2 | Populated sections, two loans, two assets, debt entry, draft + legacy + logged memos, finance and attachment metadata |
| Large stress consultation | 10 | 7 | Same populated record plus 25 loans and a 170-line memo |

These are representative regression fixtures, not a guarantee that every record fits one page. Longer records intentionally continue onto additional pages with the same readable font sizes.

## Reproduce and inspect

Run from the repository root with dependencies installed:

```sh
node --test tests/consultation-pdf.test.cjs tests/consultation-pdf-layout.test.cjs tests/consultation-pdf-ui.test.cjs
npx tsc --noEmit --pretty false
node scripts/generate-consultation-pdf-samples.cjs /tmp/lawpower-consultation-pdf-samples
pdftoppm -scale-to 1400 -png /tmp/lawpower-consultation-pdf-samples/short.pdf /tmp/lawpower-consultation-pdf-samples/short
pdftoppm -scale-to 1400 -png /tmp/lawpower-consultation-pdf-samples/populated.pdf /tmp/lawpower-consultation-pdf-samples/populated
pdftoppm -scale-to 1400 -png /tmp/lawpower-consultation-pdf-samples/stress.pdf /tmp/lawpower-consultation-pdf-samples/stress
```

Sample generation uses synthetic fixtures only and never queries production or reads customer data. It uses `pdfinfo`; PDF extraction checks additionally require Python with `pypdf` (`PDF_TEST_PYTHON` can select the interpreter). PNG rendering uses Poppler `pdftoppm`.

The layout tests check exact fixture page counts, A4 dimensions, Korean font embedding, 10 pt body text, a 9 pt minimum for all printed text, actual cell/text geometry, every supplied allowlisted field, all 25 loan end markers and all 170 memo line markers. Separate adversarial checks reconstruct an oversized multi-page debt cell, a long unbroken Korean memo and author metadata longer than one page to verify no content is lost across continuation breaks. Existing UI snapshot isolation, unsaved-draft behavior, lazy import and read-only finance tests remain unchanged.

Final visual QA rendered and inspected all 10 pages across the three compact fixtures, including their headers, continuation titles, table cells, final memo lines, attachment metadata and numbered footers. The larger type remains readable and no clipping or overlap was found.
