export default function App() {
  return (
    <main>
      <header>
        <h1>Polkupp</h1>
        <p className="tagline">Vinmonopolets prisnedsettelser, daglig.</p>
      </header>
      <section className="placeholder">
        <p>Bygges nå. Snart finner du dagens største prisnedsettelser her — med en kort omtale av hver flaske.</p>
        <p className="meta">v0.0.1 · {new Date().toLocaleDateString("no-NO")}</p>
      </section>
    </main>
  );
}
