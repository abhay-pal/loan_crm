"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  Gauge,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  PhoneCall,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserCog,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  ClientState,
  CRMUser,
  Lead,
  LeadFilters,
  LoanProduct,
  PipelineStage,
  Role,
  ViewerPermissions,
} from "@/lib/crm-types";

type SafeUser = Omit<CRMUser, "passwordHash">;
type Screen =
  | "dashboard"
  | "leads"
  | "kanban"
  | "my-day"
  | "reports"
  | "users"
  | "settings"
  | "audit";

type ApiPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  requiresOtp?: boolean;
  token?: string;
  expiresAt?: string;
  user?: SafeUser;
  permissions?: ViewerPermissions;
  state?: ClientState;
  duplicates?: MinimalLead[];
  uploadReport?: UploadReport;
  skipped?: boolean;
  leadId?: string;
};

type MinimalLead = {
  id: string;
  borrowerName: string;
  phone: string;
  email: string;
  pan: string;
  stage: string;
  assignedTo?: string;
};

type UploadReport = {
  inserted: string[];
  skipped: { row: number; reason: string; duplicate?: MinimalLead }[];
  errors: { row: number; errors: string[] }[];
};

type Toast = {
  type: "success" | "error" | "info";
  message: string;
};

type LeadFormState = {
  borrowerName: string;
  phone: string;
  email: string;
  pan: string;
  city: string;
  state: string;
  loanType: string;
  amount: string;
  tenureMonths: string;
  income: string;
  employmentType: string;
  source: string;
  priority: Lead["priority"];
  assignedTo: string;
  team: string;
  lender: string;
  remarks: string;
  tags: string;
};

const demoAccounts = [
  {
    label: "Admin",
    email: "admin@apsloancrm.com",
    password: "Preeti@123",
    note: "Full access, 2FA demo",
  },
  {
    label: "Manager",
    email: "manager@apsloancrm.com",
    password: "Team@123",
    note: "Team pipeline and assignments",
  },
  {
    label: "Agent",
    email: "agent@apsloancrm.com",
    password: "Agent@123",
    note: "Assigned lead workspace",
  },
  {
    label: "Auditor",
    email: "auditor@apsloancrm.com",
    password: "Audit@123",
    note: "Read-only reports and logs",
  },
];

const navItems: {
  id: Screen;
  label: string;
  icon: typeof LayoutDashboard;
}[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "leads", label: "Leads", icon: ListChecks },
  { id: "kanban", label: "Kanban", icon: KanbanSquare },
  { id: "my-day", label: "My Day", icon: CalendarClock },
  { id: "reports", label: "Reports", icon: Gauge },
  { id: "users", label: "Users", icon: UsersRound },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "audit", label: "Audit", icon: ShieldCheck },
];

const blankPermissions: ViewerPermissions = {
  canManageUsers: false,
  canManageSettings: false,
  canAssignLeads: false,
  canEditLeads: false,
  canDeleteLeads: false,
  canExport: false,
  canSeeAudit: false,
  canSeeAllReports: false,
};

const blankLeadForm: LeadFormState = {
  borrowerName: "",
  phone: "",
  email: "",
  pan: "",
  city: "",
  state: "",
  loanType: "",
  amount: "",
  tenureMonths: "60",
  income: "",
  employmentType: "Salaried",
  source: "",
  priority: "Normal",
  assignedTo: "",
  team: "",
  lender: "",
  remarks: "",
  tags: "",
};

const crmFields = [
  "borrowerName",
  "phone",
  "email",
  "pan",
  "city",
  "state",
  "loanType",
  "amount",
  "tenureMonths",
  "income",
  "employmentType",
  "source",
  "remarks",
] as const;

export default function LoanCrmApp() {
  const [token, setToken] = useState<string | null>(null);
  const [viewer, setViewer] = useState<SafeUser | null>(null);
  const [permissions, setPermissions] = useState(blankPermissions);
  const [crm, setCrm] = useState<ClientState | null>(null);
  const [activeScreen, setActiveScreen] = useState<Screen>("dashboard");
  const [filters, setFilters] = useState<LeadFilters>({});
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [loading, setLoading] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const showToast = useCallback((type: Toast["type"], message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const applyApiPayload = useCallback(
    (payload: ApiPayload) => {
      if (payload.token) {
        setToken(payload.token);
        window.sessionStorage.setItem("loan-crm-token", payload.token);
        window.scrollTo({ left: 0, top: 0 });
      }

      if (payload.user) {
        setViewer(payload.user);
      }

      if (payload.permissions) {
        setPermissions(payload.permissions);
      }

      if (payload.state) {
        setCrm(payload.state);
      }

      if (payload.message) {
        showToast("success", payload.message);
      }
    },
    [showToast],
  );

  useEffect(() => {
    async function restoreSession() {
      const savedToken = window.sessionStorage.getItem("loan-crm-token");

      if (!savedToken) {
        return;
      }

      setLoading(true);
      setToken(savedToken);

      try {
        applyApiPayload(await apiRequest(savedToken, "getState"));
      } catch {
        window.sessionStorage.removeItem("loan-crm-token");
        setToken(null);
      } finally {
        setLoading(false);
      }
    }

    void restoreSession();
  }, [applyApiPayload]);

  const activeLead = useMemo(
    () => crm?.leads.find((lead) => lead.id === activeLeadId) ?? null,
    [activeLeadId, crm?.leads],
  );

  const activeLeads = useMemo(() => {
    if (!crm) {
      return [];
    }

    return filterLeads(crm.leads, filters, crm, nowMs);
  }, [crm, filters, nowMs]);

  const unreadCount =
    crm?.notifications.filter((notification) => !notification.readAt).length ?? 0;

  async function api(action: string, body: Record<string, unknown> = {}) {
    if (!token) {
      throw new Error("Please sign in again.");
    }

    const payload = await apiRequest(token, action, body);
    applyApiPayload(payload);
    return payload;
  }

  async function handleLogin(values: {
    email: string;
    password: string;
    otp: string;
    rememberDevice: boolean;
  }) {
    const payload = await apiRequest(null, "login", values);

    if (payload.requiresOtp) {
      return payload;
    }

    applyApiPayload(payload);
    return payload;
  }

  async function handleLogout() {
    if (token) {
      await api("logout").catch(() => undefined);
    }

    window.sessionStorage.removeItem("loan-crm-token");
    setToken(null);
    setViewer(null);
    setCrm(null);
    setPermissions(blankPermissions);
    setActiveScreen("dashboard");
  }

  if (loading) {
    return (
      <main className="boot-screen">
        <div className="boot-mark">APS</div>
        <p>Loading Loan CRM</p>
      </main>
    );
  }

  if (!token || !viewer || !crm) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        onReset={async (email) => {
          const payload = await apiRequest(null, "requestPasswordReset", { email });
          showToast("info", payload.message ?? "Reset request recorded.");
        }}
        toast={toast}
        showToast={showToast}
      />
    );
  }

  const visibleNavItems = navItems.filter((item) => {
    if (item.id === "users") {
      return permissions.canManageUsers;
    }

    if (item.id === "settings") {
      return permissions.canManageSettings;
    }

    if (item.id === "audit") {
      return permissions.canSeeAudit;
    }

    return true;
  });

  return (
    <main className="crm-shell">
      <aside className={`sidebar ${mobileNavOpen ? "is-open" : ""}`}>
        <div className="brand-block">
          <div className="brand-logo">{crm.settings.brandInitials}</div>
          <div>
            <strong>{crm.settings.companyName}</strong>
            <span>Loan team CRM</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="CRM navigation">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;

            return (
              <button
                className={activeScreen === item.id ? "active" : ""}
                key={item.id}
                onClick={() => {
                  setActiveScreen(item.id);
                  setMobileNavOpen(false);
                }}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="role-card">
          <span>{roleName(viewer.role)}</span>
          <strong>{viewer.name}</strong>
          <small>{viewer.email}</small>
        </div>
      </aside>

      <section className="app-panel">
        <header className="topbar">
          <button
            aria-label="Open navigation"
            className="icon-button mobile-menu"
            onClick={() => setMobileNavOpen(true)}
            type="button"
          >
            <Menu size={20} />
          </button>

          <div className="global-search">
            <Search size={18} />
            <input
              aria-label="Global lead search"
              onChange={(event) =>
                setFilters((current) => ({ ...current, query: event.target.value }))
              }
              placeholder="Search name, phone, email, PAN, lead ID"
              value={filters.query ?? ""}
            />
          </div>

          <div className="topbar-actions">
            <button
              className="notification-button"
              onClick={() => setShowNotifications((current) => !current)}
              type="button"
            >
              <Bell size={18} />
              {unreadCount > 0 && <span>{unreadCount}</span>}
            </button>
            <button className="ghost-button" onClick={handleLogout} type="button">
              <LogOut size={17} />
              <span>Logout</span>
            </button>
          </div>

          {showNotifications && (
            <NotificationsPanel
              api={api}
              crm={crm}
              nowMs={nowMs}
              onClose={() => setShowNotifications(false)}
              openLead={(leadId) => {
                setActiveLeadId(leadId);
                setActiveScreen("leads");
                setShowNotifications(false);
              }}
            />
          )}
        </header>

        <section className="content-scroll">
          {activeScreen === "dashboard" && (
            <DashboardView
              crm={crm}
              leads={activeLeads}
              nowMs={nowMs}
              permissions={permissions}
              setActiveScreen={setActiveScreen}
              setFilters={setFilters}
              viewer={viewer}
            />
          )}

          {activeScreen === "leads" && (
            <LeadsView
              api={api}
              crm={crm}
              filters={filters}
              leads={activeLeads}
              nowMs={nowMs}
              onAddLead={() => setShowAddLead(true)}
              onImport={() => setShowImport(true)}
              openLead={setActiveLeadId}
              permissions={permissions}
              selectedLeadIds={selectedLeadIds}
              setFilters={setFilters}
              setSelectedLeadIds={setSelectedLeadIds}
              showToast={showToast}
            />
          )}

          {activeScreen === "kanban" && (
            <KanbanView
              api={api}
              crm={crm}
              leads={activeLeads}
              openLead={setActiveLeadId}
              permissions={permissions}
              showToast={showToast}
            />
          )}

          {activeScreen === "my-day" && (
            <MyDayView
              api={api}
              crm={crm}
              nowMs={nowMs}
              openLead={setActiveLeadId}
              viewer={viewer}
            />
          )}

          {activeScreen === "reports" && (
            <ReportsView
              crm={crm}
              leads={activeLeads}
              nowMs={nowMs}
              permissions={permissions}
              setFilters={setFilters}
              showToast={showToast}
            />
          )}

          {activeScreen === "users" && permissions.canManageUsers && (
            <UsersView
              api={api}
              crm={crm}
              onCreate={() => setShowUserModal(true)}
              showToast={showToast}
            />
          )}

          {activeScreen === "settings" && permissions.canManageSettings && (
            <SettingsView api={api} crm={crm} showToast={showToast} />
          )}

          {activeScreen === "audit" && permissions.canSeeAudit && (
            <AuditView crm={crm} />
          )}
        </section>
      </section>

      {mobileNavOpen && (
        <button
          aria-label="Close navigation"
          className="nav-scrim"
          onClick={() => setMobileNavOpen(false)}
          type="button"
        />
      )}

      {showAddLead && (
        <AddLeadModal
          api={api}
          crm={crm}
          onClose={() => setShowAddLead(false)}
          showToast={showToast}
        />
      )}

      {showImport && (
        <ImportModal
          api={api}
          crm={crm}
          onClose={() => setShowImport(false)}
          showToast={showToast}
        />
      )}

      {showUserModal && (
        <UserModal
          api={api}
          crm={crm}
          onClose={() => setShowUserModal(false)}
          showToast={showToast}
        />
      )}

      {activeLead && (
          <LeadDrawer
            api={api}
            crm={crm}
            key={activeLead.id}
            lead={activeLead}
          onClose={() => setActiveLeadId(null)}
          permissions={permissions}
          showToast={showToast}
          token={token}
          viewer={viewer}
        />
      )}

      {toast && <ToastMessage toast={toast} />}
    </main>
  );
}

function LoginScreen({
  onLogin,
  onReset,
  toast,
  showToast,
}: {
  onLogin: (values: {
    email: string;
    password: string;
    otp: string;
    rememberDevice: boolean;
  }) => Promise<ApiPayload>;
  onReset: (email: string) => Promise<void>;
  toast: Toast | null;
  showToast: (type: Toast["type"], message: string) => void;
}) {
  const [email, setEmail] = useState(demoAccounts[0].email);
  const [password, setPassword] = useState(demoAccounts[0].password);
  const [otp, setOtp] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);

    try {
      const result = await onLogin({ email, password, otp, rememberDevice });

      if (result.requiresOtp) {
        setRequiresOtp(true);
        setOtp("246810");
        showToast("info", result.message ?? "Enter the email OTP.");
      }
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="brand-block login-brand">
          <div className="brand-logo">APS</div>
          <div>
            <strong>APS Loan CRM</strong>
            <span>Private loan desk workspace</span>
          </div>
        </div>
        <div className="login-copy">
          <span className="eyebrow">Scope from Loan_CRM_Preeti.pdf</span>
          <h1>Manage every lead from capture to disbursement.</h1>
          <p>
            Role-based dashboards, lead upload, assignment, pipeline tracking,
            document checklists, notifications, reports, settings, and audit
            history are ready in one working interface.
          </p>
        </div>
        <div className="login-feature-grid">
          <FeatureBadge icon={<ShieldCheck size={18} />} label="Role access" />
          <FeatureBadge icon={<Upload size={18} />} label="CSV upload" />
          <FeatureBadge icon={<KanbanSquare size={18} />} label="Kanban board" />
          <FeatureBadge icon={<Bell size={18} />} label="Notifications" />
        </div>
      </section>

      <section className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <div>
            <span className="eyebrow">Secure sign in</span>
            <h2>Welcome back</h2>
          </div>

          <label>
            Email
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          <label>
            Password
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          {requiresOtp && (
            <label>
              Email OTP
              <input
                inputMode="numeric"
                onChange={(event) => setOtp(event.target.value)}
                required
                value={otp}
              />
            </label>
          )}

          <label className="check-row">
            <input
              checked={rememberDevice}
              onChange={(event) => setRememberDevice(event.target.checked)}
              type="checkbox"
            />
            <span>Remember this device</span>
          </label>

          <button className="primary-button" disabled={busy} type="submit">
            <LockKeyhole size={18} />
            <span>{busy ? "Signing in" : "Sign in"}</span>
          </button>

          <button
            className="link-button"
            onClick={() => {
              void onReset(email).catch((error) =>
                showToast("error", errorMessage(error)),
              );
            }}
            type="button"
          >
            Forgot password
          </button>
        </form>

        <div className="demo-grid">
          {demoAccounts.map((account) => (
            <button
              key={account.email}
              onClick={() => {
                setEmail(account.email);
                setPassword(account.password);
                setOtp("");
                setRequiresOtp(false);
              }}
              type="button"
            >
              <strong>{account.label}</strong>
              <span>{account.email}</span>
              <small>{account.note}</small>
            </button>
          ))}
        </div>
      </section>

      {toast && <ToastMessage toast={toast} />}
    </main>
  );
}

function DashboardView({
  crm,
  leads,
  nowMs,
  viewer,
  permissions,
  setActiveScreen,
  setFilters,
}: {
  crm: ClientState;
  leads: Lead[];
  nowMs: number;
  viewer: SafeUser;
  permissions: ViewerPermissions;
  setActiveScreen: (screen: Screen) => void;
  setFilters: (filters: LeadFilters | ((current: LeadFilters) => LeadFilters)) => void;
}) {
  const liveLeads = leads.filter((lead) => !lead.deletedAt);
  const today = new Date(nowMs);
  const disbursed = liveLeads.filter((lead) => lead.stage === "Disbursed");
  const openLeads = liveLeads.filter(
    (lead) => !["Disbursed", "Rejected", "Lost / Not Interested"].includes(lead.stage),
  );
  const overdue = liveLeads.filter((lead) => isLeadOverdue(lead, crm, nowMs));
  const conversion =
    liveLeads.length > 0 ? Math.round((disbursed.length / liveLeads.length) * 100) : 0;
  const disbursedValue = disbursed.reduce((sum, lead) => sum + lead.amount, 0);
  const followUps = liveLeads
    .filter((lead) => sameLocalDate(lead.followUpAt, today))
    .sort((a, b) => String(a.followUpAt).localeCompare(String(b.followUpAt)));

  return (
    <div className="screen-stack">
      <ScreenHeader
        eyebrow={`Signed in as ${roleName(viewer.role)}`}
        title="Loan Pipeline Command Center"
        subtitle="Live view of leads, follow-ups, team movement, and document readiness."
        actions={
          <>
            <button
              className="secondary-button"
              onClick={() => {
                setFilters({ overdueOnly: true });
                setActiveScreen("leads");
              }}
              type="button"
            >
              <AlertTriangle size={17} />
              <span>SLA Watch</span>
            </button>
            {permissions.canExport && (
              <button
                className="primary-button"
                onClick={() => downloadLeadsCsv(liveLeads, crm, "pipeline-export.csv")}
                type="button"
              >
                <Download size={17} />
                <span>Export</span>
              </button>
            )}
          </>
        }
      />

      <section className="metric-grid">
        <MetricCard
          icon={<ListChecks size={20} />}
          label="Open leads"
          tone="blue"
          value={openLeads.length.toString()}
          detail={`${overdue.length} on SLA watch`}
        />
        <MetricCard
          icon={<CalendarClock size={20} />}
          label="Today's follow-ups"
          tone="teal"
          value={followUps.length.toString()}
          detail="Due in My Day"
        />
        <MetricCard
          icon={<Gauge size={20} />}
          label="Conversion"
          tone="amber"
          value={`${conversion}%`}
          detail={`${disbursed.length} disbursed deals`}
        />
        <MetricCard
          icon={<CircleDollarSign size={20} />}
          label="Disbursed value"
          tone="green"
          value={shortMoney(disbursedValue)}
          detail="Current visible book"
        />
      </section>

      <div className="dashboard-grid">
        <section className="panel wide">
          <PanelTitle
            icon={<KanbanSquare size={18} />}
            title="Stage funnel"
            action={
              <button
                className="icon-button"
                onClick={() => setActiveScreen("kanban")}
                type="button"
              >
                <ChevronDown size={18} />
              </button>
            }
          />
          <div className="funnel-list">
            {crm.stages.map((stage) => {
              const count = liveLeads.filter((lead) => lead.stage === stage.name).length;
              const width = liveLeads.length ? Math.max(8, (count / liveLeads.length) * 100) : 0;

              return (
                <button
                  className="funnel-row"
                  key={stage.id}
                  onClick={() => {
                    setFilters({ stage: stage.name });
                    setActiveScreen("leads");
                  }}
                  type="button"
                >
                  <span className="stage-dot" style={{ background: stage.color }} />
                  <span>{stage.name}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ background: stage.color, width: `${width}%` }}
                    />
                  </div>
                  <strong>{count}</strong>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<CalendarClock size={18} />} title="Today's follow-ups" />
          <div className="compact-list">
            {followUps.length ? (
              followUps.map((lead) => (
                <button
                  className="mini-lead"
                  key={lead.id}
                  onClick={() => setActiveScreen("leads")}
                  type="button"
                >
                  <strong>{lead.borrowerName}</strong>
                  <span>{lead.loanType}</span>
                  <small>{formatTime(lead.followUpAt)}</small>
                </button>
              ))
            ) : (
              <EmptyState
                icon={<CheckCircle2 size={22} />}
                text="No same-day follow-ups in this view."
              />
            )}
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<UsersRound size={18} />} title="Team leaderboard" />
          <div className="leaderboard">
            {crm.users
              .filter((user) => user.role === "agent" || user.role === "manager")
              .map((user) => {
                const owned = liveLeads.filter((lead) => lead.assignedTo === user.id);
                const won = owned.filter((lead) => lead.stage === "Disbursed");
                const value = won.reduce((sum, lead) => sum + lead.amount, 0);

                return (
                  <div className="leader-row" key={user.id}>
                    <Avatar name={user.name} />
                    <div>
                      <strong>{user.name}</strong>
                      <span>{owned.length} active leads</span>
                    </div>
                    <b>{shortMoney(value)}</b>
                  </div>
                );
              })}
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<Filter size={18} />} title="Source performance" />
          <div className="source-grid">
            {crm.sources.slice(0, 6).map((source) => {
              const sourceLeads = liveLeads.filter((lead) => lead.source === source);
              const sourceWins = sourceLeads.filter((lead) => lead.stage === "Disbursed");
              const rate = sourceLeads.length
                ? Math.round((sourceWins.length / sourceLeads.length) * 100)
                : 0;

              return (
                <button
                  className="source-chip"
                  key={source}
                  onClick={() => {
                    setFilters({ source });
                    setActiveScreen("leads");
                  }}
                  type="button"
                >
                  <span>{source}</span>
                  <strong>{rate}%</strong>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function LeadsView({
  crm,
  leads,
  nowMs,
  filters,
  setFilters,
  permissions,
  selectedLeadIds,
  setSelectedLeadIds,
  openLead,
  onAddLead,
  onImport,
  api,
  showToast,
}: {
  crm: ClientState;
  leads: Lead[];
  nowMs: number;
  filters: LeadFilters;
  setFilters: (filters: LeadFilters | ((current: LeadFilters) => LeadFilters)) => void;
  permissions: ViewerPermissions;
  selectedLeadIds: Set<string>;
  setSelectedLeadIds: (selected: Set<string>) => void;
  openLead: (leadId: string) => void;
  onAddLead: () => void;
  onImport: () => void;
  api: (action: string, body?: Record<string, unknown>) => Promise<ApiPayload>;
  showToast: (type: Toast["type"], message: string) => void;
}) {
  const [savedViewName, setSavedViewName] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkStage, setBulkStage] = useState("");

  const activeLeads = leads.filter((lead) => !lead.deletedAt);
  const allSelected =
    activeLeads.length > 0 && activeLeads.every((lead) => selectedLeadIds.has(lead.id));

  async function saveCurrentView() {
    if (!savedViewName.trim()) {
      showToast("error", "Name this saved view first.");
      return;
    }

    await api("saveView", { name: savedViewName, filters });
    setSavedViewName("");
  }

  async function assignSelected() {
    if (!bulkAssignee || !selectedLeadIds.size) {
      showToast("error", "Choose leads and an assignee.");
      return;
    }

    await api("assignLeads", {
      leadIds: [...selectedLeadIds],
      assignedTo: bulkAssignee,
      reason: "Bulk assignment from lead list",
    });
    setSelectedLeadIds(new Set());
  }

  async function moveSelected() {
    if (!bulkStage || !selectedLeadIds.size) {
      showToast("error", "Choose leads and a stage.");
      return;
    }

    const remark = window.prompt("Stage-change remark is required.");

    if (!remark) {
      return;
    }

    for (const leadId of selectedLeadIds) {
      await api("changeStage", { leadId, stage: bulkStage, remark });
    }

    setSelectedLeadIds(new Set());
  }

  return (
    <div className="screen-stack">
      <ScreenHeader
        eyebrow="Lead capture and workspace"
        title="Lead Operations"
        subtitle="Create, upload, assign, search, filter, export, and open every lead record."
        actions={
          <>
            {permissions.canEditLeads && (
              <button className="secondary-button" onClick={onImport} type="button">
                <Upload size={17} />
                <span>Upload CSV</span>
              </button>
            )}
            {permissions.canEditLeads && (
              <button className="primary-button" onClick={onAddLead} type="button">
                <Plus size={17} />
                <span>Add Lead</span>
              </button>
            )}
          </>
        }
      />

      <section className="filter-panel">
        <div className="filter-grid">
          <Select
            label="Stage"
            onChange={(value) => setFilters((current) => ({ ...current, stage: value }))}
            options={["", ...crm.stages.map((stage) => stage.name)]}
            value={filters.stage ?? ""}
          />
          <Select
            label="Agent"
            onChange={(value) => setFilters((current) => ({ ...current, agent: value }))}
            options={["", ...crm.users.map((user) => user.id)]}
            renderOption={(value) =>
              value ? crm.users.find((user) => user.id === value)?.name ?? value : "All agents"
            }
            value={filters.agent ?? ""}
          />
          <Select
            label="Source"
            onChange={(value) => setFilters((current) => ({ ...current, source: value }))}
            options={["", ...crm.sources]}
            value={filters.source ?? ""}
          />
          <Select
            label="Loan type"
            onChange={(value) => setFilters((current) => ({ ...current, loanType: value }))}
            options={["", ...crm.products.map((product) => product.name)]}
            value={filters.loanType ?? ""}
          />
          <Select
            label="Priority"
            onChange={(value) => setFilters((current) => ({ ...current, priority: value }))}
            options={["", "Hot", "Warm", "Normal"]}
            value={filters.priority ?? ""}
          />
          <label className="check-filter">
            <input
              checked={Boolean(filters.overdueOnly)}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  overdueOnly: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>SLA / overdue only</span>
          </label>
        </div>
        <div className="saved-view-row">
          <div className="saved-view-buttons">
            {crm.savedViews.map((view) => (
              <button
                className="small-button"
                key={view.id}
                onClick={() => setFilters(view.filters)}
                type="button"
              >
                {view.name}
              </button>
            ))}
            <button className="small-button" onClick={() => setFilters({})} type="button">
              Clear
            </button>
          </div>
          <div className="save-view">
            <input
              aria-label="Saved view name"
              onChange={(event) => setSavedViewName(event.target.value)}
              placeholder="Save current filter"
              value={savedViewName}
            />
            <button className="icon-button" onClick={saveCurrentView} type="button">
              <Save size={17} />
            </button>
          </div>
        </div>
      </section>

      <section className="bulk-bar">
        <strong>{selectedLeadIds.size} selected</strong>
        {permissions.canAssignLeads && (
          <>
            <select
              aria-label="Bulk assignee"
              onChange={(event) => setBulkAssignee(event.target.value)}
              value={bulkAssignee}
            >
              <option value="">Assign to</option>
              {crm.users
                .filter((user) => user.status === "active" && user.role !== "viewer")
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
            </select>
            <button className="small-button" onClick={assignSelected} type="button">
              Assign
            </button>
          </>
        )}
        {permissions.canEditLeads && (
          <>
            <select
              aria-label="Bulk stage"
              onChange={(event) => setBulkStage(event.target.value)}
              value={bulkStage}
            >
              <option value="">Change stage</option>
              {crm.stages.map((stage) => (
                <option key={stage.id} value={stage.name}>
                  {stage.name}
                </option>
              ))}
            </select>
            <button className="small-button" onClick={moveSelected} type="button">
              Move
            </button>
          </>
        )}
        {permissions.canExport && (
          <button
            className="small-button"
            onClick={() => downloadLeadsCsv(activeLeads, crm, "filtered-leads.csv")}
            type="button"
          >
            Export view
          </button>
        )}
      </section>

      <section className="table-panel">
        <div className="table-scroll">
          <table className="lead-table">
            <thead>
              <tr>
                <th>
                  <input
                    aria-label="Select all leads"
                    checked={allSelected}
                    onChange={(event) =>
                      setSelectedLeadIds(
                        event.target.checked
                          ? new Set(activeLeads.map((lead) => lead.id))
                          : new Set(),
                      )
                    }
                    type="checkbox"
                  />
                </th>
                <th>Lead</th>
                <th>Loan</th>
                <th>Stage</th>
                <th>Owner</th>
                <th>Docs</th>
                <th>Follow-up</th>
                <th>SLA</th>
              </tr>
            </thead>
            <tbody>
              {activeLeads.map((lead) => {
                const owner = crm.users.find((user) => user.id === lead.assignedTo);
                const progress = documentProgress(lead, crm);

                return (
                  <tr key={lead.id}>
                    <td>
                      <input
                        aria-label={`Select ${lead.borrowerName}`}
                        checked={selectedLeadIds.has(lead.id)}
                        onChange={(event) => {
                          const next = new Set(selectedLeadIds);
                          if (event.target.checked) {
                            next.add(lead.id);
                          } else {
                            next.delete(lead.id);
                          }
                          setSelectedLeadIds(next);
                        }}
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <button className="lead-link" onClick={() => openLead(lead.id)} type="button">
                        <strong>{lead.borrowerName}</strong>
                        <span>
                          {lead.id} - {lead.phone}
                        </span>
                      </button>
                    </td>
                    <td>
                      <strong>{lead.loanType}</strong>
                      <span>{shortMoney(lead.amount)}</span>
                    </td>
                    <td>
                      <StagePill crm={crm} stageName={lead.stage} />
                    </td>
                    <td>{owner?.name ?? "Unassigned"}</td>
                    <td>
                      <ProgressLine value={progress.received} max={progress.total} />
                    </td>
                    <td>{lead.followUpAt ? formatDateTime(lead.followUpAt) : "Not set"}</td>
                    <td>
                      {isLeadOverdue(lead, crm, nowMs) ? (
                        <span className="status-danger">Watch</span>
                      ) : (
                        <span className="status-ok">Clear</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!activeLeads.length && (
          <EmptyState
            icon={<Filter size={24} />}
            text="No leads match the current filters."
          />
        )}
      </section>
    </div>
  );
}

function KanbanView({
  crm,
  leads,
  permissions,
  openLead,
  api,
  showToast,
}: {
  crm: ClientState;
  leads: Lead[];
  permissions: ViewerPermissions;
  openLead: (leadId: string) => void;
  api: (action: string, body?: Record<string, unknown>) => Promise<ApiPayload>;
  showToast: (type: Toast["type"], message: string) => void;
}) {
  const [draggedLead, setDraggedLead] = useState<string | null>(null);

  async function dropLead(stageName: string) {
    if (!draggedLead || !permissions.canEditLeads) {
      return;
    }

    const lead = leads.find((candidate) => candidate.id === draggedLead);

    if (!lead || lead.stage === stageName) {
      setDraggedLead(null);
      return;
    }

    const remark = window.prompt(`Move ${lead.borrowerName} to ${stageName}. Add remark:`);

    if (!remark) {
      setDraggedLead(null);
      return;
    }

    try {
      await api("changeStage", { leadId: lead.id, stage: stageName, remark });
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setDraggedLead(null);
    }
  }

  return (
    <div className="screen-stack">
      <ScreenHeader
        eyebrow="Drag pipeline"
        title="Kanban Board"
        subtitle="Move leads across configured stages with a required stage-change remark."
      />
      <section className="kanban-board">
        {crm.stages.map((stage) => {
          const stageLeads = leads.filter(
            (lead) => !lead.deletedAt && lead.stage === stage.name,
          );

          return (
            <div
              className="kanban-column"
              key={stage.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => void dropLead(stage.name)}
            >
              <div className="kanban-heading">
                <span className="stage-dot" style={{ background: stage.color }} />
                <strong>{stage.name}</strong>
                <b>{stageLeads.length}</b>
              </div>
              <div className="kanban-stack">
                {stageLeads.map((lead) => {
                  const owner = crm.users.find((user) => user.id === lead.assignedTo);
                  const progress = documentProgress(lead, crm);

                  return (
                    <button
                      className="kanban-card"
                      draggable={permissions.canEditLeads}
                      key={lead.id}
                      onClick={() => openLead(lead.id)}
                      onDragStart={() => setDraggedLead(lead.id)}
                      type="button"
                    >
                      <span className={`priority ${lead.priority.toLowerCase()}`}>
                        {lead.priority}
                      </span>
                      <strong>{lead.borrowerName}</strong>
                      <span>{shortMoney(lead.amount)} - {lead.loanType}</span>
                      <small>{owner?.name ?? "Unassigned"}</small>
                      <ProgressLine value={progress.received} max={progress.total} />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function MyDayView({
  crm,
  viewer,
  nowMs,
  openLead,
  api,
}: {
  crm: ClientState;
  viewer: SafeUser;
  nowMs: number;
  openLead: (leadId: string) => void;
  api: (action: string, body?: Record<string, unknown>) => Promise<ApiPayload>;
}) {
  const today = new Date(nowMs);
  const myLeads = crm.leads.filter(
    (lead) => !lead.deletedAt && (viewer.role !== "agent" || lead.assignedTo === viewer.id),
  );
  const due = myLeads
    .filter(
      (lead) =>
        lead.followUpAt &&
        (sameLocalDate(lead.followUpAt, today) ||
          new Date(lead.followUpAt).getTime() < nowMs),
    )
    .sort((a, b) => String(a.followUpAt).localeCompare(String(b.followUpAt)));
  const tasks = myLeads.flatMap((lead) =>
    lead.tasks
      .filter((task) => !task.done)
      .map((task) => ({
        ...task,
        leadId: lead.id,
        borrowerName: lead.borrowerName,
      })),
  );

  return (
    <div className="screen-stack">
      <ScreenHeader
        eyebrow="Daily queue"
        title="My Day"
        subtitle="Follow-ups, open tasks, overdue leads, and personal conversion signals."
      />
      <div className="my-day-grid">
        <section className="panel">
          <PanelTitle icon={<CalendarClock size={18} />} title="Follow-ups" />
          <div className="compact-list">
            {due.map((lead) => (
              <button
                className="task-row"
                key={lead.id}
                onClick={() => openLead(lead.id)}
                type="button"
              >
                <Clock3 size={17} />
                <div>
                  <strong>{lead.borrowerName}</strong>
                  <span>{formatDateTime(lead.followUpAt)}</span>
                </div>
              </button>
            ))}
            {!due.length && (
              <EmptyState icon={<CheckCircle2 size={22} />} text="No follow-ups due." />
            )}
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<ClipboardCheck size={18} />} title="Open tasks" />
          <div className="compact-list">
            {tasks.map((task) => (
              <label className="task-row" key={task.id}>
                <input
                  aria-label={`Mark ${task.title} complete`}
                  onChange={(event) =>
                    void api("toggleTask", {
                      leadId: task.leadId,
                      taskId: task.id,
                      done: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.borrowerName}</span>
                </div>
              </label>
            ))}
            {!tasks.length && (
              <EmptyState icon={<CheckCircle2 size={22} />} text="No open tasks." />
            )}
          </div>
        </section>

        <section className="panel wide">
          <PanelTitle icon={<AlertTriangle size={18} />} title="SLA watchlist" />
          <div className="lead-card-grid">
            {myLeads.filter((lead) => isLeadOverdue(lead, crm, nowMs)).map((lead) => (
              <button
                className="summary-card"
                key={lead.id}
                onClick={() => openLead(lead.id)}
                type="button"
              >
                <strong>{lead.borrowerName}</strong>
                <span>{lead.stage}</span>
                <small>Last touch {relativeDate(lead.lastTouchedAt, nowMs)}</small>
              </button>
            ))}
            {!myLeads.some((lead) => isLeadOverdue(lead, crm, nowMs)) && (
              <EmptyState icon={<CheckCircle2 size={22} />} text="No SLA breaches." />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ReportsView({
  crm,
  leads,
  nowMs,
  permissions,
  setFilters,
  showToast,
}: {
  crm: ClientState;
  leads: Lead[];
  nowMs: number;
  permissions: ViewerPermissions;
  setFilters: (filters: LeadFilters | ((current: LeadFilters) => LeadFilters)) => void;
  showToast: (type: Toast["type"], message: string) => void;
}) {
  const activeLeads = leads.filter((lead) => !lead.deletedAt);
  const byStage = crm.stages.map((stage) => ({
    stage: stage.name,
    count: activeLeads.filter((lead) => lead.stage === stage.name).length,
    amount: activeLeads
      .filter((lead) => lead.stage === stage.name)
      .reduce((sum, lead) => sum + lead.amount, 0),
  }));
  const ageing = activeLeads
    .map((lead) => ({
      lead,
      age: Math.floor((nowMs - new Date(lead.lastTouchedAt).getTime()) / 86400000),
    }))
    .sort((a, b) => b.age - a.age)
    .slice(0, 8);
  const sourceRows = crm.sources.map((source) => {
    const sourceLeads = activeLeads.filter((lead) => lead.source === source);
    const won = sourceLeads.filter((lead) => lead.stage === "Disbursed");

    return {
      source,
      leads: sourceLeads.length,
      conversion: sourceLeads.length
        ? Math.round((won.length / sourceLeads.length) * 100)
        : 0,
      value: won.reduce((sum, lead) => sum + lead.amount, 0),
    };
  });

  return (
    <div className="screen-stack">
      <ScreenHeader
        eyebrow="Manager reports"
        title="Reports and Exports"
        subtitle="Funnel, source conversion, ageing, stage value, and CSV-ready lists."
        actions={
          permissions.canExport ? (
            <button
              className="primary-button"
              onClick={() => {
                downloadLeadsCsv(activeLeads, crm, "loan-crm-report.csv");
                showToast("success", "Report exported.");
              }}
              type="button"
            >
              <Download size={17} />
              <span>Export CSV</span>
            </button>
          ) : null
        }
      />

      <div className="reports-grid">
        <section className="panel wide">
          <PanelTitle icon={<Gauge size={18} />} title="Stage distribution" />
          <div className="report-bars">
            {byStage.map((row) => (
              <button
                className="report-bar"
                key={row.stage}
                onClick={() => setFilters({ stage: row.stage })}
                type="button"
              >
                <span>{row.stage}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${activeLeads.length ? (row.count / activeLeads.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <strong>{row.count}</strong>
                <small>{shortMoney(row.amount)}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<Filter size={18} />} title="Source conversion" />
          <div className="compact-list">
            {sourceRows.map((row) => (
              <div className="source-report-row" key={row.source}>
                <div>
                  <strong>{row.source}</strong>
                  <span>{row.leads} leads</span>
                </div>
                <b>{row.conversion}%</b>
              </div>
            ))}
          </div>
        </section>

        <section className="panel wide">
          <PanelTitle icon={<AlertTriangle size={18} />} title="Ageing report" />
          <div className="table-scroll">
            <table className="compact-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Stage</th>
                  <th>Owner</th>
                  <th>Age</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {ageing.map(({ lead, age }) => (
                  <tr key={lead.id}>
                    <td>{lead.borrowerName}</td>
                    <td>{lead.stage}</td>
                    <td>
                      {crm.users.find((user) => user.id === lead.assignedTo)?.name ??
                        "Unassigned"}
                    </td>
                    <td>{age} days</td>
                    <td>{shortMoney(lead.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function UsersView({
  crm,
  api,
  onCreate,
  showToast,
}: {
  crm: ClientState;
  api: (action: string, body?: Record<string, unknown>) => Promise<ApiPayload>;
  onCreate: () => void;
  showToast: (type: Toast["type"], message: string) => void;
}) {
  return (
    <div className="screen-stack">
      <ScreenHeader
        eyebrow="Access control"
        title="Users and Teams"
        subtitle="Create users, set roles, team ownership, 2FA, status, and capacity limits."
        actions={
          <button className="primary-button" onClick={onCreate} type="button">
            <Plus size={17} />
            <span>Add User</span>
          </button>
        }
      />
      <section className="table-panel">
        <div className="table-scroll">
          <table className="lead-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Team</th>
                <th>Capacity</th>
                <th>2FA</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {crm.users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="user-cell">
                      <Avatar name={user.name} />
                      <div>
                        <strong>{user.name}</strong>
                        <span>{user.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>{roleName(user.role)}</td>
                  <td>{user.team}</td>
                  <td>
                    {user.capacityDaily}/day - {user.capacityMonthly}/mo
                  </td>
                  <td>{user.twoFactorEnabled ? "Enabled" : "Off"}</td>
                  <td>
                    <span className={user.status === "active" ? "status-ok" : "status-danger"}>
                      {user.status}
                    </span>
                  </td>
                  <td>
                    <button
                      className="small-button"
                      onClick={() =>
                        void api("deactivateUser", { userId: user.id }).catch((error) =>
                          showToast("error", errorMessage(error)),
                        )
                      }
                      type="button"
                    >
                      {user.status === "active" ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SettingsView({
  crm,
  api,
  showToast,
}: {
  crm: ClientState;
  api: (action: string, body?: Record<string, unknown>) => Promise<ApiPayload>;
  showToast: (type: Toast["type"], message: string) => void;
}) {
  const [companyName, setCompanyName] = useState(crm.settings.companyName);
  const [brandInitials, setBrandInitials] = useState(crm.settings.brandInitials);
  const [slaDays, setSlaDays] = useState(String(crm.settings.slaDays));
  const [autoAssignmentMode, setAutoAssignmentMode] = useState(
    crm.settings.autoAssignmentMode,
  );
  const [dailyDigestTime, setDailyDigestTime] = useState(crm.settings.dailyDigestTime);
  const [emailEnabled, setEmailEnabled] = useState(crm.settings.emailEnabled);
  const [browserPushEnabled, setBrowserPushEnabled] = useState(
    crm.settings.browserPushEnabled,
  );
  const [sources, setSources] = useState(crm.sources.join("\n"));
  const [lenders, setLenders] = useState(crm.lenders.join("\n"));
  const [rejectionReasons, setRejectionReasons] = useState(
    crm.rejectionReasons.join("\n"),
  );
  const [lostReasons, setLostReasons] = useState(crm.lostReasons.join("\n"));
  const [products, setProducts] = useState(crm.products);
  const [stages, setStages] = useState(crm.stages);

  async function save() {
    try {
      await api("updateSettings", {
        settings: {
          ...crm.settings,
          companyName,
          brandInitials,
          slaDays: Number(slaDays) || 3,
          autoAssignmentMode,
          dailyDigestTime,
          emailEnabled,
          browserPushEnabled,
        },
        sources: listFromTextarea(sources),
        lenders: listFromTextarea(lenders),
        rejectionReasons: listFromTextarea(rejectionReasons),
        lostReasons: listFromTextarea(lostReasons),
        products,
        stages,
      });
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }

  function updateProduct(productId: string, updates: Partial<LoanProduct>) {
    setProducts((current) =>
      current.map((product) =>
        product.id === productId ? { ...product, ...updates } : product,
      ),
    );
  }

  function updateStage(stageId: string, updates: Partial<PipelineStage>) {
    setStages((current) =>
      current.map((stage) => (stage.id === stageId ? { ...stage, ...updates } : stage)),
    );
  }

  return (
    <div className="screen-stack">
      <ScreenHeader
        eyebrow="Masters"
        title="Settings"
        subtitle="Configure products, stages, sources, lenders, notification defaults, SLA, and branding."
        actions={
          <button className="primary-button" onClick={save} type="button">
            <Save size={17} />
            <span>Save Settings</span>
          </button>
        }
      />
      <div className="settings-grid">
        <section className="panel">
          <PanelTitle icon={<Settings size={18} />} title="Company" />
          <div className="form-grid single">
            <TextField label="Company name" onChange={setCompanyName} value={companyName} />
            <TextField
              label="Brand initials"
              maxLength={6}
              onChange={setBrandInitials}
              value={brandInitials}
            />
            <TextField
              label="SLA days"
              onChange={setSlaDays}
              type="number"
              value={slaDays}
            />
            <label>
              Auto assignment
              <select
                onChange={(event) =>
                  setAutoAssignmentMode(
                    event.target.value as typeof crm.settings.autoAssignmentMode,
                  )
                }
                value={autoAssignmentMode}
              >
                <option value="round-robin">Round-robin</option>
                <option value="loan-type">By loan type</option>
                <option value="city">By city</option>
                <option value="manual">Manual only</option>
              </select>
            </label>
            <TextField
              label="Daily digest time"
              onChange={setDailyDigestTime}
              type="time"
              value={dailyDigestTime}
            />
            <label className="check-row">
              <input
                checked={emailEnabled}
                onChange={(event) => setEmailEnabled(event.target.checked)}
                type="checkbox"
              />
              <span>Email notifications</span>
            </label>
            <label className="check-row">
              <input
                checked={browserPushEnabled}
                onChange={(event) => setBrowserPushEnabled(event.target.checked)}
                type="checkbox"
              />
              <span>Browser push add-on</span>
            </label>
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<SlidersHorizontal size={18} />} title="Lists" />
          <div className="form-grid two-column">
            <TextareaField label="Lead sources" onChange={setSources} value={sources} />
            <TextareaField label="Lenders" onChange={setLenders} value={lenders} />
            <TextareaField
              label="Rejection reasons"
              onChange={setRejectionReasons}
              value={rejectionReasons}
            />
            <TextareaField label="Lost reasons" onChange={setLostReasons} value={lostReasons} />
          </div>
        </section>

        <section className="panel wide">
          <PanelTitle
            icon={<FileCheck2 size={18} />}
            title="Loan products and document checklists"
            action={
              <button
                className="small-button"
                onClick={() =>
                  setProducts((current) => [
                    ...current,
                    {
                      id: crypto.randomUUID(),
                      name: "New Product",
                      fields: [],
                      checklist: ["PAN card"],
                    },
                  ])
                }
                type="button"
              >
                Add product
              </button>
            }
          />
          <div className="product-settings">
            {products.map((product) => (
              <div className="product-editor" key={product.id}>
                <TextField
                  label="Product"
                  onChange={(value) => updateProduct(product.id, { name: value })}
                  value={product.name}
                />
                <TextareaField
                  label="Fields"
                  onChange={(value) =>
                    updateProduct(product.id, { fields: listFromTextarea(value) })
                  }
                  value={product.fields.join("\n")}
                />
                <TextareaField
                  label="Checklist"
                  onChange={(value) =>
                    updateProduct(product.id, { checklist: listFromTextarea(value) })
                  }
                  value={product.checklist.join("\n")}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="panel wide">
          <PanelTitle
            icon={<KanbanSquare size={18} />}
            title="Pipeline stages"
            action={
              <button
                className="small-button"
                onClick={() =>
                  setStages((current) => [
                    ...current,
                    {
                      id: crypto.randomUUID(),
                      name: "New Stage",
                      color: "#475569",
                      order: current.length + 1,
                      kind: "open",
                      approvalRequired: false,
                    },
                  ])
                }
                type="button"
              >
                Add stage
              </button>
            }
          />
          <div className="table-scroll">
            <table className="compact-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Name</th>
                  <th>Color</th>
                  <th>Kind</th>
                  <th>Approval</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((stage) => (
                  <tr key={stage.id}>
                    <td>
                      <input
                        aria-label="Stage order"
                        onChange={(event) =>
                          updateStage(stage.id, { order: Number(event.target.value) })
                        }
                        type="number"
                        value={stage.order}
                      />
                    </td>
                    <td>
                      <input
                        aria-label="Stage name"
                        onChange={(event) =>
                          updateStage(stage.id, { name: event.target.value })
                        }
                        value={stage.name}
                      />
                    </td>
                    <td>
                      <input
                        aria-label="Stage color"
                        onChange={(event) =>
                          updateStage(stage.id, { color: event.target.value })
                        }
                        type="color"
                        value={stage.color}
                      />
                    </td>
                    <td>
                      <select
                        aria-label="Stage kind"
                        onChange={(event) =>
                          updateStage(stage.id, {
                            kind: event.target.value as PipelineStage["kind"],
                          })
                        }
                        value={stage.kind}
                      >
                        <option value="open">Open</option>
                        <option value="won">Won</option>
                        <option value="lost">Lost</option>
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label="Approval required"
                        checked={stage.approvalRequired}
                        onChange={(event) =>
                          updateStage(stage.id, {
                            approvalRequired: event.target.checked,
                          })
                        }
                        type="checkbox"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function AuditView({ crm }: { crm: ClientState }) {
  return (
    <div className="screen-stack">
      <ScreenHeader
        eyebrow="Security"
        title="Audit and Login History"
        subtitle="Every create, edit, stage move, upload, export, login, and delete is recorded."
      />
      <div className="audit-grid">
        <section className="panel wide">
          <PanelTitle icon={<Activity size={18} />} title="Audit trail" />
          <div className="timeline-list">
            {crm.audits.map((audit) => (
              <div className="timeline-item" key={audit.id}>
                <span className="timeline-dot" />
                <div>
                  <strong>{audit.action.replace(/_/g, " ")}</strong>
                  <p>{audit.detail}</p>
                  <small>
                    {formatDateTime(audit.createdAt)} -{" "}
                    {crm.users.find((user) => user.id === audit.userId)?.name ?? audit.userId} -{" "}
                    {audit.ip}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <PanelTitle icon={<LockKeyhole size={18} />} title="Login history" />
          <div className="compact-list">
            {crm.loginHistory.map((entry) => (
              <div className="source-report-row" key={entry.id}>
                <div>
                  <strong>{entry.email}</strong>
                  <span>{formatDateTime(entry.createdAt)}</span>
                </div>
                <b className={entry.status === "success" ? "status-ok" : "status-danger"}>
                  {entry.status}
                </b>
              </div>
            ))}
            {!crm.loginHistory.length && (
              <EmptyState icon={<Eye size={22} />} text="No login events yet." />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function AddLeadModal({
  crm,
  api,
  onClose,
  showToast,
}: {
  crm: ClientState;
  api: (action: string, body?: Record<string, unknown>) => Promise<ApiPayload>;
  onClose: () => void;
  showToast: (type: Toast["type"], message: string) => void;
}) {
  const [form, setForm] = useState<LeadFormState>({
    ...blankLeadForm,
    loanType: crm.products[0]?.name ?? "",
    source: crm.sources[0] ?? "",
    team: crm.teams[0]?.name ?? "",
  });
  const [duplicates, setDuplicates] = useState<MinimalLead[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(mode?: "skip" | "merge" | "create") {
    setBusy(true);

    try {
      await api("createLead", { lead: leadPayloadFromForm(form), duplicateMode: mode });
      onClose();
    } catch (error) {
      const apiError = error as Error & { data?: ApiPayload; status?: number };
      if (apiError.status === 409 && apiError.data?.duplicates) {
        setDuplicates(apiError.data.duplicates);
      } else {
        showToast("error", errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Add lead">
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <LeadForm crm={crm} form={form} setForm={setForm} />
        {duplicates.length > 0 && (
          <div className="duplicate-box">
            <strong>Duplicate detected</strong>
            {duplicates.map((duplicate) => (
              <p key={duplicate.id}>
                {duplicate.borrowerName} - {duplicate.phone} - {duplicate.stage}
              </p>
            ))}
            <div className="button-row">
              <button className="small-button" onClick={() => void submit("skip")} type="button">
                Skip
              </button>
              <button className="small-button" onClick={() => void submit("merge")} type="button">
                Merge
              </button>
              <button className="secondary-button" onClick={() => void submit("create")} type="button">
                Create anyway
              </button>
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={busy} type="submit">
            <Plus size={17} />
            <span>{busy ? "Saving" : "Save lead"}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({
  crm,
  api,
  onClose,
  showToast,
}: {
  crm: ClientState;
  api: (action: string, body?: Record<string, unknown>) => Promise<ApiPayload>;
  onClose: () => void;
  showToast: (type: Toast["type"], message: string) => void;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateMode, setDuplicateMode] = useState("skip");
  const [report, setReport] = useState<UploadReport | null>(null);

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const parsed = parseCsv(await file.text());
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(autoMapping(parsed.headers));
  }

  const mappedRows = rows.map((row) => {
    const output: Record<string, string> = {};

    crmFields.forEach((field) => {
      const header = mapping[field];
      output[field] = header ? row[header] ?? "" : "";
    });

    return output;
  });

  async function uploadRows() {
    if (!mappedRows.length) {
      showToast("error", "Choose a CSV file first.");
      return;
    }

    try {
      const payload = await api("bulkUpload", {
        leads: mappedRows,
        duplicateMode,
      });
      setReport(payload.uploadReport ?? null);
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }

  return (
    <Modal onClose={onClose} title="Bulk upload leads">
      <div className="import-stack">
        <div className="button-row">
          <label className="file-drop">
            <Upload size={18} />
            <span>Choose CSV</span>
            <input accept=".csv,text/csv" onChange={readFile} type="file" />
          </label>
          <button
            className="secondary-button"
            onClick={() => downloadCsvTemplate(crm)}
            type="button"
          >
            <Download size={17} />
            <span>Template</span>
          </button>
        </div>

        {headers.length > 0 && (
          <>
            <div className="mapping-grid">
              {crmFields.map((field) => (
                <label key={field}>
                  {humanize(field)}
                  <select
                    onChange={(event) =>
                      setMapping((current) => ({ ...current, [field]: event.target.value }))
                    }
                    value={mapping[field] ?? ""}
                  >
                    <option value="">Ignore</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label>
              Duplicate handling
              <select
                onChange={(event) => setDuplicateMode(event.target.value)}
                value={duplicateMode}
              >
                <option value="skip">Skip duplicates</option>
                <option value="merge">Merge into existing</option>
                <option value="create">Create anyway</option>
              </select>
            </label>
            <div className="preview-box">
              <strong>{mappedRows.length} rows ready</strong>
              <span>{mappedRows.slice(0, 1)[0]?.borrowerName || "Map borrower name"}</span>
            </div>
          </>
        )}

        {report && (
          <div className="upload-report">
            <strong>Upload report</strong>
            <span>{report.inserted.length} saved</span>
            <span>{report.skipped.length} skipped</span>
            <span>{report.errors.length} invalid</span>
          </div>
        )}

        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
          <button className="primary-button" onClick={uploadRows} type="button">
            <Upload size={17} />
            <span>Import rows</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UserModal({
  crm,
  api,
  onClose,
  showToast,
}: {
  crm: ClientState;
  api: (action: string, body?: Record<string, unknown>) => Promise<ApiPayload>;
  onClose: () => void;
  showToast: (type: Toast["type"], message: string) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "agent" as Role,
    team: crm.teams[0]?.name ?? "West",
    managerId: crm.users.find((user) => user.role === "manager")?.id ?? "",
    phone: "",
    capacityDaily: "15",
    capacityMonthly: "250",
    twoFactorEnabled: false,
    password: "Welcome@123",
  });

  async function submit(event: FormEvent) {
    event.preventDefault();

    try {
      await api("createUser", {
        user: {
          ...form,
          capacityDaily: Number(form.capacityDaily),
          capacityMonthly: Number(form.capacityMonthly),
        },
      });
      onClose();
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }

  return (
    <Modal onClose={onClose} title="Add user">
      <form className="form-grid" onSubmit={submit}>
        <TextField
          label="Name"
          onChange={(value) => setForm((current) => ({ ...current, name: value }))}
          value={form.name}
        />
        <TextField
          label="Email"
          onChange={(value) => setForm((current) => ({ ...current, email: value }))}
          type="email"
          value={form.email}
        />
        <label>
          Role
          <select
            onChange={(event) =>
              setForm((current) => ({ ...current, role: event.target.value as Role }))
            }
            value={form.role}
          >
            <option value="admin">Admin / Owner</option>
            <option value="manager">Team Manager</option>
            <option value="agent">Loan Officer / Agent</option>
            <option value="viewer">Viewer / Auditor</option>
          </select>
        </label>
        <label>
          Team
          <select
            onChange={(event) =>
              setForm((current) => ({ ...current, team: event.target.value }))
            }
            value={form.team}
          >
            {crm.teams.map((team) => (
              <option key={team.id} value={team.name}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Manager
          <select
            onChange={(event) =>
              setForm((current) => ({ ...current, managerId: event.target.value }))
            }
            value={form.managerId}
          >
            <option value="">None</option>
            {crm.users
              .filter((user) => user.role === "manager" || user.role === "admin")
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
          </select>
        </label>
        <TextField
          label="Phone"
          onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
          value={form.phone}
        />
        <TextField
          label="Daily capacity"
          onChange={(value) =>
            setForm((current) => ({ ...current, capacityDaily: value }))
          }
          type="number"
          value={form.capacityDaily}
        />
        <TextField
          label="Monthly capacity"
          onChange={(value) =>
            setForm((current) => ({ ...current, capacityMonthly: value }))
          }
          type="number"
          value={form.capacityMonthly}
        />
        <TextField
          label="Temporary password"
          onChange={(value) => setForm((current) => ({ ...current, password: value }))}
          value={form.password}
        />
        <label className="check-row">
          <input
            checked={form.twoFactorEnabled}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                twoFactorEnabled: event.target.checked,
              }))
            }
            type="checkbox"
          />
          <span>Email OTP</span>
        </label>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" type="submit">
            <UserCog size={17} />
            <span>Create user</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LeadDrawer({
  crm,
  lead,
  viewer,
  permissions,
  token,
  api,
  onClose,
  showToast,
}: {
  crm: ClientState;
  lead: Lead;
  viewer: SafeUser;
  permissions: ViewerPermissions;
  token: string;
  api: (action: string, body?: Record<string, unknown>) => Promise<ApiPayload>;
  onClose: () => void;
  showToast: (type: Toast["type"], message: string) => void;
}) {
  const [tab, setTab] = useState<"details" | "activity" | "documents">("details");
  const [draft, setDraft] = useState(leadFormFromLead(lead));
  const [stage, setStage] = useState(lead.stage);
  const [stageRemark, setStageRemark] = useState("");
  const [stageReason, setStageReason] = useState("");
  const [note, setNote] = useState("");
  const [callOutcome, setCallOutcome] = useState("connected");
  const [callDuration, setCallDuration] = useState("5");
  const [nextAction, setNextAction] = useState("");
  const [followUpAt, setFollowUpAt] = useState(toLocalDateTimeInput(lead.followUpAt));
  const [taskTitle, setTaskTitle] = useState("");
  const [documentItem, setDocumentItem] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);

  const owner = crm.users.find((user) => user.id === lead.assignedTo);
  const product = crm.products.find((candidate) => candidate.name === lead.loanType);
  const progress = documentProgress(lead, crm);
  const activities = crm.activities.filter((activity) => activity.leadId === lead.id);
  const canEdit = permissions.canEditLeads && viewer.role !== "viewer";

  async function saveLead() {
    try {
      await api("updateLead", {
        leadId: lead.id,
        updates: leadPayloadFromForm(draft),
      });
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }

  async function moveStage() {
    if (!stageRemark.trim()) {
      showToast("error", "Stage-change remark is required.");
      return;
    }

    try {
      await api("changeStage", {
        leadId: lead.id,
        stage,
        remark: stageRemark,
        reason: stageReason,
      });
      setStageRemark("");
      setStageReason("");
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }

  async function addNote() {
    try {
      await api("addNote", { leadId: lead.id, body: note });
      setNote("");
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }

  async function saveCall() {
    try {
      await api("logCall", {
        leadId: lead.id,
        outcome: callOutcome,
        duration: Number(callDuration),
        nextAction,
        followUpAt: followUpAt ? new Date(followUpAt).toISOString() : "",
      });
      setNextAction("");
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }

  async function addTask() {
    try {
      await api("addTask", { leadId: lead.id, title: taskTitle });
      setTaskTitle("");
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }

  async function uploadDocument() {
    if (!documentFile) {
      showToast("error", "Choose a document first.");
      return;
    }

    const form = new FormData();
    form.set("leadId", lead.id);
    form.set("checklistItem", documentItem || product?.checklist[0] || "General");
    form.set("file", documentFile);

    try {
      const response = await fetch("/api/crm/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      const payload = (await response.json()) as ApiPayload;

      if (!response.ok) {
        throw apiError(payload, response.status);
      }

      if (payload.state) {
        showToast("success", payload.message ?? "Document uploaded.");
      }

      await api("getState");
      setDocumentFile(null);
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }

  async function openDocument(documentId: string) {
    try {
      const response = await fetch(`/api/crm/documents?id=${encodeURIComponent(documentId)}`, {
        headers: { authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiPayload;
        throw apiError(payload, response.status);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }

  return (
    <aside className="drawer" aria-label="Lead workspace">
      <div className="drawer-header">
        <div>
          <span className="eyebrow">{lead.id}</span>
          <h2>{lead.borrowerName}</h2>
          <p>
            {lead.loanType} - {shortMoney(lead.amount)} - {owner?.name ?? "Unassigned"}
          </p>
        </div>
        <button className="icon-button" onClick={onClose} type="button">
          <X size={20} />
        </button>
      </div>

      <div className="drawer-tabs">
        {["details", "activity", "documents"].map((item) => (
          <button
            className={tab === item ? "active" : ""}
            key={item}
            onClick={() => setTab(item as typeof tab)}
            type="button"
          >
            {humanize(item)}
          </button>
        ))}
      </div>

      <div className="drawer-body">
        {tab === "details" && (
          <div className="drawer-grid">
            <section className="panel">
              <PanelTitle icon={<FileText size={18} />} title="Borrower and loan" />
              <div className="form-grid">
                <LeadForm crm={crm} disabled={!canEdit} form={draft} setForm={setDraft} />
              </div>
              {canEdit && (
                <button className="primary-button full-width" onClick={saveLead} type="button">
                  <Save size={17} />
                  <span>Save details</span>
                </button>
              )}
            </section>

            <section className="panel">
              <PanelTitle icon={<KanbanSquare size={18} />} title="Stage move" />
              <div className="form-grid single">
                <label>
                  Stage
                  <select
                    disabled={!canEdit}
                    onChange={(event) => setStage(event.target.value)}
                    value={stage}
                  >
                    {crm.stages.map((stageOption) => (
                      <option key={stageOption.id} value={stageOption.name}>
                        {stageOption.name}
                      </option>
                    ))}
                  </select>
                </label>
                {(stage === "Rejected" || stage === "Lost / Not Interested") && (
                  <label>
                    Reason
                    <select
                      disabled={!canEdit}
                      onChange={(event) => setStageReason(event.target.value)}
                      value={stageReason}
                    >
                      <option value="">Choose reason</option>
                      {(stage === "Rejected"
                        ? crm.rejectionReasons
                        : crm.lostReasons
                      ).map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <TextareaField
                  disabled={!canEdit}
                  label="Mandatory remark"
                  onChange={setStageRemark}
                  value={stageRemark}
                />
                {canEdit && (
                  <button className="secondary-button" onClick={moveStage} type="button">
                    <RefreshCw size={17} />
                    <span>Move stage</span>
                  </button>
                )}
              </div>
            </section>

            <section className="panel">
              <PanelTitle icon={<CalendarClock size={18} />} title="Follow-up and calls" />
              <div className="form-grid single">
                <TextField
                  disabled={!canEdit}
                  label="Follow-up"
                  onChange={setFollowUpAt}
                  type="datetime-local"
                  value={followUpAt}
                />
                <label>
                  Call outcome
                  <select
                    disabled={!canEdit}
                    onChange={(event) => setCallOutcome(event.target.value)}
                    value={callOutcome}
                  >
                    <option value="connected">Connected</option>
                    <option value="no answer">No answer</option>
                    <option value="busy">Busy</option>
                    <option value="callback">Callback</option>
                  </select>
                </label>
                <TextField
                  disabled={!canEdit}
                  label="Duration minutes"
                  onChange={setCallDuration}
                  type="number"
                  value={callDuration}
                />
                <TextField
                  disabled={!canEdit}
                  label="Next action"
                  onChange={setNextAction}
                  value={nextAction}
                />
                {canEdit && (
                  <button className="secondary-button" onClick={saveCall} type="button">
                    <PhoneCall size={17} />
                    <span>Log call</span>
                  </button>
                )}
              </div>
            </section>

            <section className="panel">
              <PanelTitle icon={<ClipboardCheck size={18} />} title="Tasks" />
              <div className="compact-list">
                {lead.tasks.map((task) => (
                  <label className="task-row" key={task.id}>
                    <input
                      checked={task.done}
                      aria-label={`Mark ${task.title} complete`}
                      disabled={!canEdit}
                      onChange={(event) =>
                        void api("toggleTask", {
                          leadId: lead.id,
                          taskId: task.id,
                          done: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    <div>
                      <strong>{task.title}</strong>
                      <span>{task.dueAt ? formatDateTime(task.dueAt) : "No due date"}</span>
                    </div>
                  </label>
                ))}
              </div>
              {canEdit && (
                <div className="inline-add">
                  <input
                    aria-label="Task title"
                    onChange={(event) => setTaskTitle(event.target.value)}
                    placeholder="Add checklist task"
                    value={taskTitle}
                  />
                  <button className="icon-button" onClick={addTask} type="button">
                    <Plus size={17} />
                  </button>
                </div>
              )}
            </section>

            <section className="panel wide">
              <PanelTitle icon={<Activity size={18} />} title="Notes and comments" />
              <TextareaField
                disabled={!canEdit}
                label="Internal note"
                onChange={setNote}
                value={note}
              />
              {canEdit && (
                <button className="secondary-button" onClick={addNote} type="button">
                  <Mail size={17} />
                  <span>Add note</span>
                </button>
              )}
            </section>
          </div>
        )}

        {tab === "activity" && (
          <section className="panel">
            <PanelTitle icon={<Activity size={18} />} title="Activity timeline" />
            <div className="timeline-list">
              {activities.map((activity) => (
                <div className="timeline-item" key={activity.id}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>{activity.title}</strong>
                    <p>{activity.body}</p>
                    <small>
                      {formatDateTime(activity.createdAt)} -{" "}
                      {crm.users.find((user) => user.id === activity.userId)?.name ??
                        activity.userId}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "documents" && (
          <div className="drawer-grid">
            <section className="panel">
              <PanelTitle icon={<FileCheck2 size={18} />} title="Checklist" />
              <ProgressLine value={progress.received} max={progress.total} />
              <div className="checklist-list">
                {progress.checklist.map((item) => {
                  const docs = lead.documents.filter(
                    (document) => document.checklistItem === item,
                  );

                  return (
                    <div className="checklist-row" key={item}>
                      {docs.length ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                      <span>{item}</span>
                      <strong>{docs.length ? `v${docs[0].version}` : "Pending"}</strong>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel">
              <PanelTitle icon={<Upload size={18} />} title="Upload document" />
              <div className="form-grid single">
                <label>
                  Checklist item
                  <select
                    disabled={!canEdit}
                    onChange={(event) => setDocumentItem(event.target.value)}
                    value={documentItem}
                  >
                    <option value="">General</option>
                    {product?.checklist.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="file-drop">
                  <Upload size={18} />
                  <span>{documentFile?.name ?? "Choose file"}</span>
                  <input
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    disabled={!canEdit}
                    onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>
                {canEdit && (
                  <button className="primary-button" onClick={uploadDocument} type="button">
                    <Upload size={17} />
                    <span>Upload</span>
                  </button>
                )}
              </div>
            </section>

            <section className="panel wide">
              <PanelTitle icon={<FileText size={18} />} title="Document versions" />
              <div className="compact-list">
                {lead.documents.map((document) => (
                  <div className="document-row" key={document.id}>
                    <FileText size={18} />
                    <div>
                      <strong>{document.name}</strong>
                      <span>
                        {document.checklistItem} - v{document.version} -{" "}
                        {formatBytes(document.size)}
                      </span>
                    </div>
                    <button
                      className="icon-button"
                      onClick={() => void openDocument(document.id)}
                      type="button"
                    >
                      <Eye size={17} />
                    </button>
                    {canEdit && (
                      <button
                        className="icon-button danger"
                        onClick={() =>
                          void api("deleteDocument", {
                            leadId: lead.id,
                            documentId: document.id,
                          }).catch((error) => showToast("error", errorMessage(error)))
                        }
                        type="button"
                      >
                        <Trash2 size={17} />
                      </button>
                    )}
                  </div>
                ))}
                {!lead.documents.length && (
                  <EmptyState icon={<FileText size={22} />} text="No documents uploaded." />
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}

function NotificationsPanel({
  crm,
  api,
  nowMs,
  onClose,
  openLead,
}: {
  crm: ClientState;
  api: (action: string, body?: Record<string, unknown>) => Promise<ApiPayload>;
  nowMs: number;
  onClose: () => void;
  openLead: (leadId: string) => void;
}) {
  return (
    <aside className="notifications-panel">
      <div className="panel-head">
        <strong>Notifications</strong>
        <button className="icon-button" onClick={onClose} type="button">
          <X size={17} />
        </button>
      </div>
      <div className="compact-list">
        {crm.notifications.map((notification) => (
          <button
            className={`notification-row ${notification.readAt ? "" : "unread"}`}
            key={notification.id}
            onClick={() => {
              if (notification.leadId) {
                openLead(notification.leadId);
              }
              void api("markNotification", { id: notification.id });
            }}
            type="button"
          >
            <strong>{notification.title}</strong>
            <span>{notification.body}</span>
            <small>{relativeDate(notification.createdAt, nowMs)}</small>
          </button>
        ))}
        {!crm.notifications.length && (
          <EmptyState icon={<Bell size={22} />} text="No notifications." />
        )}
      </div>
      <button
        className="secondary-button full-width"
        onClick={() => void api("markAllNotifications")}
        type="button"
      >
        Mark all read
      </button>
    </aside>
  );
}

function LeadForm({
  crm,
  form,
  setForm,
  disabled = false,
}: {
  crm: ClientState;
  form: LeadFormState;
  setForm: (updater: LeadFormState | ((current: LeadFormState) => LeadFormState)) => void;
  disabled?: boolean;
}) {
  function update(field: keyof LeadFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <>
      <TextField
        disabled={disabled}
        label="Borrower name"
        onChange={(value) => update("borrowerName", value)}
        value={form.borrowerName}
      />
      <TextField
        disabled={disabled}
        label="Phone"
        onChange={(value) => update("phone", value)}
        value={form.phone}
      />
      <TextField
        disabled={disabled}
        label="Email"
        onChange={(value) => update("email", value)}
        type="email"
        value={form.email}
      />
      <TextField
        disabled={disabled}
        label="PAN"
        onChange={(value) => update("pan", value.toUpperCase())}
        value={form.pan}
      />
      <TextField
        disabled={disabled}
        label="City"
        onChange={(value) => update("city", value)}
        value={form.city}
      />
      <TextField
        disabled={disabled}
        label="State"
        onChange={(value) => update("state", value)}
        value={form.state}
      />
      <label>
        Loan type
        <select
          disabled={disabled}
          onChange={(event) => update("loanType", event.target.value)}
          value={form.loanType}
        >
          {crm.products.map((product) => (
            <option key={product.id} value={product.name}>
              {product.name}
            </option>
          ))}
        </select>
      </label>
      <TextField
        disabled={disabled}
        label="Amount required"
        onChange={(value) => update("amount", value)}
        type="number"
        value={form.amount}
      />
      <TextField
        disabled={disabled}
        label="Tenure months"
        onChange={(value) => update("tenureMonths", value)}
        type="number"
        value={form.tenureMonths}
      />
      <TextField
        disabled={disabled}
        label="Monthly income"
        onChange={(value) => update("income", value)}
        type="number"
        value={form.income}
      />
      <label>
        Employment
        <select
          disabled={disabled}
          onChange={(event) => update("employmentType", event.target.value)}
          value={form.employmentType}
        >
          {["Salaried", "Self-employed", "Business owner", "Retired", "Other"].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label>
        Source
        <select
          disabled={disabled}
          onChange={(event) => update("source", event.target.value)}
          value={form.source}
        >
          {crm.sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select
          disabled={disabled}
          onChange={(event) => update("priority", event.target.value)}
          value={form.priority}
        >
          <option value="Hot">Hot</option>
          <option value="Warm">Warm</option>
          <option value="Normal">Normal</option>
        </select>
      </label>
      <label>
        Assignee
        <select
          disabled={disabled}
          onChange={(event) => update("assignedTo", event.target.value)}
          value={form.assignedTo}
        >
          <option value="">Auto / unassigned</option>
          {crm.users
            .filter((user) => user.status === "active" && user.role !== "viewer")
            .map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Team
        <select
          disabled={disabled}
          onChange={(event) => update("team", event.target.value)}
          value={form.team}
        >
          {crm.teams.map((team) => (
            <option key={team.id} value={team.name}>
              {team.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Lender
        <select
          disabled={disabled}
          onChange={(event) => update("lender", event.target.value)}
          value={form.lender}
        >
          <option value="">Not selected</option>
          {crm.lenders.map((lender) => (
            <option key={lender} value={lender}>
              {lender}
            </option>
          ))}
        </select>
      </label>
      <TextField
        disabled={disabled}
        label="Tags"
        onChange={(value) => update("tags", value)}
        value={form.tags}
      />
      <TextareaField
        disabled={disabled}
        label="Remarks"
        onChange={(value) => update("remarks", value)}
        value={form.remarks}
      />
    </>
  );
}

function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="screen-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  );
}

function PanelTitle({
  icon,
  title,
  action,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-title">
      <span>{icon}</span>
      <strong>{title}</strong>
      {action}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function FeatureBadge({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="feature-badge">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function StagePill({ crm, stageName }: { crm: ClientState; stageName: string }) {
  const stage = crm.stages.find((candidate) => candidate.name === stageName);

  return (
    <span className="stage-pill" style={{ "--stage-color": stage?.color ?? "#64748b" } as React.CSSProperties}>
      {stageName}
    </span>
  );
}

function ProgressLine({ value, max }: { value: number; max: number }) {
  const percent = max ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div className="progress-line">
      <div>
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>
        {value} of {max || 0}
      </small>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="empty-state">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return <span className="avatar">{initials(name)}</span>;
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button aria-label="Close modal" className="modal-scrim" onClick={onClose} type="button" />
      <section className="modal-card">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={19} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
  maxLength?: number;
}) {
  return (
    <label>
      {label}
      <input
        disabled={disabled}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <textarea
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function Select({
  label,
  options,
  value,
  onChange,
  renderOption,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  renderOption?: (value: string) => string;
}) {
  return (
    <label>
      {label}
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option || "all"} value={option}>
            {renderOption ? renderOption(option) : option || "All"}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToastMessage({ toast }: { toast: Toast }) {
  return (
    <div className={`toast ${toast.type}`} role="status">
      {toast.type === "error" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
      <span>{toast.message}</span>
    </div>
  );
}

async function apiRequest(
  token: string | null,
  action: string,
  body: Record<string, unknown> = {},
) {
  const response = await fetch("/api/crm", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...body }),
  });
  const payload = (await response.json()) as ApiPayload;

  if (!response.ok) {
    throw apiError(payload, response.status);
  }

  return payload;
}

function apiError(payload: ApiPayload, status: number) {
  const error = new Error(payload.error ?? "CRM request failed.") as Error & {
    data?: ApiPayload;
    status?: number;
  };
  error.data = payload;
  error.status = status;
  return error;
}

function leadPayloadFromForm(form: LeadFormState) {
  return {
    ...form,
    amount: Number(form.amount),
    tenureMonths: Number(form.tenureMonths),
    income: Number(form.income),
    assignedTo: form.assignedTo || undefined,
    lender: form.lender || undefined,
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

function leadFormFromLead(lead: Lead): LeadFormState {
  return {
    borrowerName: lead.borrowerName,
    phone: lead.phone,
    email: lead.email,
    pan: lead.pan,
    city: lead.city,
    state: lead.state,
    loanType: lead.loanType,
    amount: String(lead.amount),
    tenureMonths: String(lead.tenureMonths),
    income: String(lead.income),
    employmentType: lead.employmentType,
    source: lead.source,
    priority: lead.priority,
    assignedTo: lead.assignedTo ?? "",
    team: lead.team,
    lender: lead.lender ?? "",
    remarks: lead.remarks,
    tags: lead.tags.join(", "),
  };
}

function filterLeads(
  leads: Lead[],
  filters: LeadFilters,
  crm: ClientState,
  nowMs: number,
) {
  const query = filters.query?.trim().toLowerCase();

  return leads.filter((lead) => {
    if (lead.deletedAt) {
      return false;
    }

    if (query) {
      const haystack = [
        lead.id,
        lead.borrowerName,
        lead.phone,
        lead.email,
        lead.pan,
        lead.city,
        lead.state,
        lead.loanType,
        lead.source,
        lead.stage,
      ]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (filters.stage && lead.stage !== filters.stage) {
      return false;
    }

    if (filters.agent && lead.assignedTo !== filters.agent) {
      return false;
    }

    if (filters.team && lead.team !== filters.team) {
      return false;
    }

    if (filters.source && lead.source !== filters.source) {
      return false;
    }

    if (filters.loanType && lead.loanType !== filters.loanType) {
      return false;
    }

    if (filters.priority && lead.priority !== filters.priority) {
      return false;
    }

    if (filters.amountMin && lead.amount < filters.amountMin) {
      return false;
    }

    if (filters.amountMax && lead.amount > filters.amountMax) {
      return false;
    }

    if (filters.overdueOnly && !isLeadOverdue(lead, crm, nowMs)) {
      return false;
    }

    return true;
  });
}

function isLeadOverdue(lead: Lead, crm: ClientState, nowMs: number) {
  const terminal = ["Disbursed", "Rejected", "Lost / Not Interested"].includes(lead.stage);
  const followUpOverdue =
    lead.followUpAt && new Date(lead.followUpAt).getTime() < nowMs;
  const stale =
    nowMs - new Date(lead.lastTouchedAt).getTime() >
    crm.settings.slaDays * 24 * 60 * 60 * 1000;

  return !terminal && Boolean(followUpOverdue || stale);
}

function documentProgress(lead: Lead, crm: ClientState) {
  const product = crm.products.find((candidate) => candidate.name === lead.loanType);
  const checklist = product?.checklist ?? [];
  const received = new Set(lead.documents.map((document) => document.checklistItem));

  return {
    total: checklist.length,
    received: checklist.filter((item) => received.has(item)).length,
    checklist,
  };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  const headers = rows[0] ?? [];
  const data = rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );

  return { headers, rows: data };
}

function autoMapping(headers: string[]) {
  const mapping: Record<string, string> = {};

  crmFields.forEach((field) => {
    const normalizedField = field.toLowerCase();
    const match = headers.find(
      (header) =>
        header.toLowerCase().replace(/[^a-z0-9]/g, "") ===
        normalizedField.toLowerCase().replace(/[^a-z0-9]/g, ""),
    );
    if (match) {
      mapping[field] = match;
    }
  });

  return mapping;
}

function downloadCsvTemplate(crm: ClientState) {
  const row = [
    "borrowerName",
    "phone",
    "email",
    "pan",
    "city",
    "state",
    "loanType",
    "amount",
    "tenureMonths",
    "income",
    "employmentType",
    "source",
    "remarks",
  ];
  const sample = [
    "Asha Kapoor",
    "9876543210",
    "asha.kapoor@example.com",
    "ABCDE1111F",
    "Mumbai",
    "Maharashtra",
    crm.products[0]?.name ?? "Home Loan",
    "4500000",
    "240",
    "120000",
    "Salaried",
    crm.sources[0] ?? "Website",
    "Ready for eligibility check",
  ];
  downloadText("loan-crm-upload-template.csv", `${row.join(",")}\n${sample.join(",")}`);
}

function downloadLeadsCsv(leads: Lead[], crm: ClientState, filename: string) {
  const headers = [
    "Lead ID",
    "Borrower",
    "Phone",
    "Email",
    "PAN",
    "City",
    "State",
    "Loan Type",
    "Amount",
    "Stage",
    "Owner",
    "Source",
    "Follow-up",
    "Created",
  ];
  const rows = leads.map((lead) => [
    lead.id,
    lead.borrowerName,
    lead.phone,
    lead.email,
    lead.pan,
    lead.city,
    lead.state,
    lead.loanType,
    String(lead.amount),
    lead.stage,
    crm.users.find((user) => user.id === lead.assignedTo)?.name ?? "Unassigned",
    lead.source,
    lead.followUpAt ?? "",
    lead.createdAt,
  ]);

  downloadText(
    filename,
    [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n"),
  );
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function listFromTextarea(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function roleName(role: Role) {
  return {
    admin: "Admin / Owner",
    manager: "Team Manager",
    agent: "Loan Officer / Agent",
    viewer: "Viewer / Auditor",
  }[role];
}

function shortMoney(value: number) {
  if (value >= 10000000) {
    return `INR ${(value / 10000000).toFixed(value % 10000000 ? 1 : 0)} Cr`;
  }

  if (value >= 100000) {
    return `INR ${(value / 100000).toFixed(value % 100000 ? 1 : 0)} L`;
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value?: string) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value?: string) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function sameLocalDate(value: string | undefined, date: Date) {
  if (!value) {
    return false;
  }

  const other = new Date(value);
  return (
    other.getFullYear() === date.getFullYear() &&
    other.getMonth() === date.getMonth() &&
    other.getDate() === date.getDate()
  );
}

function relativeDate(value: string, nowMs: number) {
  const delta = nowMs - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(delta / 60000));

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hr ago`;
  }

  return `${Math.floor(hours / 24)} days ago`;
}

function formatBytes(value: number) {
  if (value > 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function toLocalDateTimeInput(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function humanize(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/[-_]/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
