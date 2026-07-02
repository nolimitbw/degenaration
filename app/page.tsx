import ScrollProgress from "@/components/ScrollProgress";
import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Ticker from "@/components/Ticker";
import Stats from "@/components/Stats";
import Features from "@/components/Features";
import Groups from "@/components/Groups";
import How from "@/components/How";
import Cta from "@/components/Cta";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main>
      <ScrollProgress />
      <Nav />
      <Hero />
      <Ticker />
      <Stats />
      <Features />
      <Groups />
      <How />
      <Cta />
      <Footer />
    </main>
  );
}
