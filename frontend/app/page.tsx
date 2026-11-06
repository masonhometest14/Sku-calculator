import Link from "next/link";
import styles from "./page.module.css";

const features = [
  { number: "01", title: "SKU economics", detail: "Track product costs, fees, taxes, and contribution margin." },
  { number: "02", title: "Channel comparison", detail: "Compare selling channels using independent assumptions." },
  { number: "03", title: "Buying decisions", detail: "Review profitability alongside inventory and lead time." },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">MASON <span>HOME</span></Link>
        <span className={styles.status}><i /> Local workspace</span>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>MERCHANDISE INTELLIGENCE</p>
        <h1>Know what each<br />product really earns.</h1>
        <p className={styles.lede}>A workspace for SKU profitability, channel decisions, and smarter buying.</p>
        <a className={styles.button} href="http://localhost:8000">Open the current app <span aria-hidden="true">↗</span></a>
        <p className={styles.note}>Backend runs locally at localhost:8000</p>
      </section>

      <section className={styles.features} aria-label="Workspace features">
        {features.map((feature) => (
          <article className={styles.card} key={feature.number}>
            <span className={styles.number}>{feature.number}</span>
            <h2>{feature.title}</h2>
            <p>{feature.detail}</p>
          </article>
        ))}
      </section>

      <footer className={styles.footer}>
        <span>Mason Home</span><span>Frontend · Next.js</span>
      </footer>
    </main>
  );
}

