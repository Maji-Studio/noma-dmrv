import { createRoot } from "react-dom/client";
import { ProductOrderUiPrototype } from "../product-order-ui-prototype";
import { usePathname } from "./navigation";
import "../../../app/globals.css";
function Preview() {
  const path = usePathname();
  return <div className="min-h-screen md:grid md:grid-cols-[auto_1fr]">
    <aside className="hidden border-r border-[var(--hair)] bg-[var(--paper)] p-24 md:block"><p className="title-heading-3">noma</p><p className="label-micro mt-24">Synthetic facility</p><nav className="mt-24 flex flex-col gap-16 body-small"><a href={`/biochar-products?prototype=stock`}>Biochar products</a><a href={`/orders?prototype=stock`}>Orders</a></nav></aside>
    <main className="min-w-0"><ProductOrderUiPrototype key={path} standalone mode={path.startsWith("/orders") ? "order" : "product"} /></main>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
