import { createRoot } from "react-dom/client";
import { ProductOrderUiPrototype } from "../product-order-ui-prototype";
import { readVariant } from "../variant-layout";
import { usePathname, useSearchParams } from "./navigation";
import "../../../app/globals.css";
function Preview() {
  const path = usePathname();
  const variant = readVariant(useSearchParams().get("variant"));
  return <div className="min-h-screen md:grid md:grid-cols-[auto_1fr]">
    <aside className="hidden border-r border-[var(--hair)] bg-[var(--paper)] p-24 md:block"><p className="title-heading-3">noma</p><p className="label-micro mt-24">Synthetic facility</p><nav className="mt-24 flex flex-col gap-16 body-small"><a href={`/biochar-products?prototype=stock&variant=${variant}`}>Biochar products</a><a href={`/orders?prototype=stock&variant=${variant}`}>Orders</a></nav></aside>
    <main className="min-w-0"><ProductOrderUiPrototype key={path} standalone mode={path.startsWith("/orders") ? "order" : "product"} /></main>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
