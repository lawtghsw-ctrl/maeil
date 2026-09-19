import {Sidebar} from "@/components/sidebar";
import {Header} from "@/components/header";
import {AdminStoreProvider} from "@/components/store";
export default function AdminLayout({children}:{children:React.ReactNode}){return <AdminStoreProvider><Sidebar/><div className="min-h-screen lg:pl-[248px]"><Header/><main className="min-w-0 max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-7">{children}</main></div></AdminStoreProvider>}
