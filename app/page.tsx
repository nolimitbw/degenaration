import ScrollProgress from "@/components/ScrollProgress";
import ScrollVideoBackground from "@/components/ScrollVideoBackground";
import Loader from "@/components/Loader";
import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Ticker from "@/components/Ticker";
import Stats from "@/components/Stats";
import Features from "@/components/Features";
import Groups from "@/components/Groups";
import How from "@/components/How";
import Roadmap from "@/components/Roadmap";
import Cta from "@/components/Cta";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <div className="degen-home">
      <Loader />
      <ScrollVideoBackground />
      <ScrollProgress />
      <Nav />
      <main className="relative z-10">
        <Hero />
        <Ticker />
        <Stats />
        <Features />
        <Groups />
        <How />
        <Roadmap />
        <Cta />
        <Footer />
      </main>
    </div>
  );
}
