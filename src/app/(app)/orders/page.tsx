import { OrderList } from "@/components/orders";
import { ProductOrderUiPrototype } from "@/components/form-prototypes/product-order-ui-prototype";

type SearchParams = Promise<{ prototype?: string; variant?: string }>;

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  // Throwaway UI exploration only. The existing (app) authentication guard is unchanged.
  if (process.env.NODE_ENV !== "production" && query.prototype === "stock") {
    return <ProductOrderUiPrototype mode="order" />;
  }
  return <OrderList />;
}
