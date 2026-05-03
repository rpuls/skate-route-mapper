const features = [
  "Inspect ingested rides and route metadata",
  "Review sample counts, GPS density, and vibration summaries",
  "Prepare a foundation for future QA and analytics tooling",
];

export default function App() {
  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Skate Route Mapper</p>
        <h1>Admin Dashboard</h1>
        <p className="lede">
          A lightweight operations surface for reviewing recorded rides,
          ingestion health, and route-quality data as the platform grows.
        </p>
      </section>

      <section className="panel">
        <h2>What this app will do</h2>
        <ul className="featureList">
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </section>

      <section className="grid">
        <article className="card">
          <h3>API container</h3>
          <p>Fastify service for ride lifecycle events and batched sample ingestion.</p>
        </article>

        <article className="card">
          <h3>Database container</h3>
          <p>PostgreSQL stores rides, samples, and derived metrics in one source of truth.</p>
        </article>

        <article className="card">
          <h3>Admin container</h3>
          <p>This app will become the internal view for QA, support, and analytics workflows.</p>
        </article>
      </section>
    </main>
  );
}
