import { redirect } from "next/navigation";

// Spec section 9: normal users see Bots, Affiliate and Portfolio. This legacy surface
// is no longer part of the product. The route is kept as a redirect rather than deleted so
// an existing bookmark or an old link lands somewhere real instead of on a 404.
export default function DemoRedirect() {
  redirect("/bots");
}
