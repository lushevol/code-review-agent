import { Routes, Route, Link, useLocation } from "react-router-dom";
import DashboardOverview from "./pages/DashboardOverview";
import FindingsPage from "./pages/FindingsPage";
import PRsPage from "./pages/PRsPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  const location = useLocation();

  const navItems = [
    { path: "/", label: "Overview", icon: "\u{1F4CA}" },
    { path: "/findings", label: "Findings", icon: "\u{1F50D}" },
    { path: "/prs", label: "Pull Requests", icon: "\u{1F500}" },
    { path: "/admin", label: "Admin", icon: "\u{2699}\u{FE0F}" },
  ];

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <nav
        style={{
          width: 220,
          background: "#1a1a2e",
          color: "#eee",
          padding: "1rem",
          flexShrink: 0,
        }}
      >
        <h2 style={{ fontSize: "1.1rem", marginBottom: "2rem", color: "#e94560" }}>
          PR Guardian
        </h2>
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            style={{
              display: "block",
              padding: "0.75rem 1rem",
              marginBottom: "0.25rem",
              borderRadius: 8,
              textDecoration: "none",
              color: location.pathname === item.path ? "#fff" : "#999",
              background: location.pathname === item.path ? "#16213e" : "transparent",
            }}
          >
            {item.icon} {item.label}
          </Link>
        ))}
      </nav>
      <main style={{ flex: 1, padding: "2rem", background: "#f5f5f5" }}>
        <Routes>
          <Route path="/" element={<DashboardOverview />} />
          <Route path="/findings" element={<FindingsPage />} />
          <Route path="/prs" element={<PRsPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </div>
  );
}
