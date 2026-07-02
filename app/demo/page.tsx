import { redirect } from "next/navigation";

// The paper-trading demo was removed — everything on the site is now real data.
export default function DemoRedirect() {
  redirect("/trenches");
}
