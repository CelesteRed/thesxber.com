export default function AdminSection({ title, count, dirty = 0, errors = 0, children }) {
  return <details className="admin-section">
    <summary>
      <span className="admin-section-title">{title}{count !== undefined && <span className="admin-section-count">{count}</span>}</span>
      <span className="admin-section-badges">
        {dirty > 0 && <span>{dirty} unsaved</span>}
        {errors > 0 && <span className="admin-row-error">{errors} need attention</span>}
      </span>
    </summary>
    <div className="admin-section-content">{children}</div>
  </details>;
}
