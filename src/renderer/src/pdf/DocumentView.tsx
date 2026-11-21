import type { CustomerDocument } from '@shared/documents'

/** The printable document. Rendered both in the hidden PDF window and in the in-app preview. */
export function DocumentView({ doc }: { doc: CustomerDocument }) {
  return (
    <div className="inkdoc" style={{ ['--doc-accent' as string]: doc.accent }}>
      {doc.stamp && <div className="inkdoc-stamp">{doc.stamp}</div>}
      <header className="inkdoc-head">
        <div className="inkdoc-shop">
          {doc.shop.logo_url && <img className="inkdoc-logo" src={doc.shop.logo_url} alt="" />}
          <div>
            <div className="inkdoc-shopname">{doc.shop.name}</div>
            {doc.shop.lines.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>
        </div>
        <div className="inkdoc-title">
          <h1>{doc.title}</h1>
          <div className="inkdoc-number">{doc.number}</div>
          <table className="inkdoc-meta">
            <tbody>
              {doc.meta.map((m) => (
                <tr key={m.label}>
                  <th>{m.label}</th>
                  <td>{m.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </header>

      <section className="inkdoc-parties">
        {doc.bill_to.length > 0 && (
          <div>
            <h3>{doc.type === 'receipt' ? 'Received from' : doc.type === 'invoice' || doc.ship_to.length ? 'Bill to' : 'Prepared for'}</h3>
            {doc.bill_to.map((l, i) => (
              <div key={i} className={i === 0 ? 'inkdoc-strong' : ''}>
                {l}
              </div>
            ))}
          </div>
        )}
        {doc.ship_to.length > 0 && (
          <div>
            <h3>Ship to</h3>
            {doc.ship_to.map((l, i) => (
              <div key={i} className={i === 0 ? 'inkdoc-strong' : ''}>
                {l}
              </div>
            ))}
          </div>
        )}
        {doc.job_name && (
          <div>
            <h3>Job</h3>
            <div className="inkdoc-strong">{doc.job_name}</div>
          </div>
        )}
      </section>

      {doc.receipt && (
        <section className="inkdoc-receipt">
          <h2>{doc.receipt.heading}</h2>
          <table>
            <tbody>
              {doc.receipt.rows.map((r) => (
                <tr key={r.label}>
                  <th>{r.label}</th>
                  <td>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(doc.lines.length > 0 || doc.fees.length > 0) && (
      <table className="inkdoc-items">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Each</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i} className="inkdoc-line">
              <td>
                <div className="inkdoc-strong">
                  {l.title}
                  {l.color && <span className="inkdoc-color"> · {l.color}</span>}
                </div>
                {l.description && <div className="inkdoc-muted">{l.description}</div>}
                <div className="inkdoc-sizes">{l.sizes}</div>
                {l.imprints.map((x) => (
                  <div key={x} className="inkdoc-imprint">
                    {x}
                  </div>
                ))}
              </td>
              <td className="num">{l.qty}</td>
              <td className="num">
                {l.unit_prices.map((u) => (
                  <div key={u}>{u}</div>
                ))}
              </td>
              <td className="num inkdoc-strong">{l.total}</td>
            </tr>
          ))}
          {doc.fees.map((f, i) => (
            <tr key={`fee-${i}`} className="inkdoc-fee">
              <td colSpan={2}>{f.name}</td>
              <td className="num">{f.detail}</td>
              <td className="num">{f.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}

      <section className="inkdoc-summary">
        <div className="inkdoc-notes">
          {doc.notes && (
            <>
              <h3>Notes</h3>
              <p>{doc.notes}</p>
            </>
          )}
        </div>
        <div className="inkdoc-totals">
          <table>
            <tbody>
              {doc.totals.map((t) => (
                <tr key={t.label} className={t.strong ? 'inkdoc-grand' : t.muted ? 'inkdoc-muted' : ''}>
                  <th>{t.label}</th>
                  <td className="num">{t.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {doc.callout && (
            <div className="inkdoc-callout">
              <span>{doc.callout.label}</span>
              <strong>{doc.callout.amount}</strong>
            </div>
          )}
        </div>
      </section>

      {doc.how_to_pay && (
        <section className="inkdoc-howtopay">
          <h3>How to pay</h3>
          <p>{doc.how_to_pay}</p>
        </section>
      )}

      {doc.images.length > 0 && (
        <section className="inkdoc-images">
          {/* Rows of two that never split; the heading travels with the first row. */}
          {Array.from({ length: Math.ceil(doc.images.length / 2) }, (_, r) => (
            <div key={r} className="inkdoc-imgrow">
              {r === 0 && <h3>Mockups</h3>}
              <div className="inkdoc-grid">
                {doc.images.slice(r * 2, r * 2 + 2).map((img, i) => (
                  <figure key={i}>
                    <img src={img.url} alt={img.caption} />
                    {img.caption && <figcaption>{img.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {(doc.terms || doc.signature) && (
        <section className="inkdoc-terms">
          {doc.terms && (
            <>
              <h3>Terms &amp; conditions</h3>
              <p>{doc.terms}</p>
            </>
          )}
          {doc.signature && (
            <div className="inkdoc-sign">
              <div>
                <span />
                Approved by (signature)
              </div>
              <div>
                <span />
                Printed name
              </div>
              <div className="inkdoc-sign-date">
                <span />
                Date
              </div>
            </div>
          )}
        </section>
      )}
      {doc.footer && <footer className="inkdoc-footer">{doc.footer}</footer>}
    </div>
  )
}
