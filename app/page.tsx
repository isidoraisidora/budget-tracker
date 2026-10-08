"use client";

import { useEffect, useState, type FormEvent } from "react";

type Account = {
  id: string;
  name: string;
  type: "cash" | "card";
  balance: number;
};

type Category = "Food" | "Clothes" | "Coffee" | "Travelling" | "Other";
type Goal = {
  id: string;
  name: string;
  target: number;
  saved: number;
};
type Transaction = {
  id: string;
  type: "expense" | "withdrawal" | "payment" | "saving";
  amount: number;
  date: string;
  category?: Category;
  accountId: string;
  destinationAccountId?: string;
  goalId?: string;
};

const categories: Category[] = ["Food", "Clothes", "Coffee", "Travelling", "Other"];
const storageKey = "pocket-ledger-data";
const credentialKey = "pocket-ledger-credentials";
const sessionKey = "pocket-ledger-session";
const userStorageKey = (username: string) => `${storageKey}-${username}`;
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const money = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
const passwordHash = async (password: string, salt: Uint8Array) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt.buffer as ArrayBuffer, iterations: 120000 }, key, 256);
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export default function Home() {
  const [accounts, setAccounts] = useState<Account[]>([
    { id: "cash", name: "Cash", type: "cash", balance: 0 },
  ]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [activeUser, setActiveUser] = useState<string | null>(null);
  const [hasCredential, setHasCredential] = useState(false);
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [authError, setAuthError] = useState("");
  const [modal, setModal] = useState<"transaction" | "account" | "goal" | "save" | null>(null);
  const [selectedGoalId, setSelectedGoalId] = useState("");
  const [transactionType, setTransactionType] = useState<"expense" | "withdrawal" | "payment">("expense");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let savedUsername: string | undefined;
    let hasSavedCredential = false;
    try {
      const credential = window.localStorage.getItem(credentialKey);
      if (credential) {
        savedUsername = (JSON.parse(credential) as { username?: string }).username;
        hasSavedCredential = Boolean(savedUsername);
      }
    } catch {
      window.localStorage.removeItem(credentialKey);
    }
    queueMicrotask(() => {
      setHasCredential(hasSavedCredential);
      if (hasSavedCredential) setAuthMode("login");
      if (savedUsername && window.localStorage.getItem(sessionKey) === savedUsername) setActiveUser(savedUsername);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!authReady || !activeUser) return;
    let savedAccounts: Account[] | undefined;
    let savedTransactions: Transaction[] | undefined;
    let savedGoals: Goal[] | undefined;
    try {
      const saved = window.localStorage.getItem(userStorageKey(activeUser)) ?? window.localStorage.getItem(storageKey);
      if (saved) {
        const data = JSON.parse(saved) as { accounts?: Account[]; transactions?: Transaction[]; goals?: Goal[] };
        if (Array.isArray(data.accounts)) savedAccounts = data.accounts;
        if (Array.isArray(data.transactions)) savedTransactions = data.transactions;
        if (Array.isArray(data.goals)) savedGoals = data.goals;
      }
    } catch {
      window.localStorage.removeItem(userStorageKey(activeUser));
    }
    queueMicrotask(() => {
      setAccounts(savedAccounts ?? [{ id: "cash", name: "Cash", type: "cash", balance: 0 }]);
      setTransactions(savedTransactions ?? []);
      setGoals(savedGoals ?? []);
      setIsReady(true);
    });
  }, [activeUser, authReady]);

  useEffect(() => {
    if (isReady && activeUser) {
      window.localStorage.setItem(userStorageKey(activeUser), JSON.stringify({ accounts, transactions, goals }));
    }
  }, [accounts, transactions, goals, isReady, activeUser]);

  const currentDate = isReady ? today() : "";
  const month = currentDate.slice(0, 7);
  const monthTransactions = transactions.filter(
    (transaction) => transaction.type === "expense" && transaction.date.startsWith(month),
  );
  const spentThisMonth = monthTransactions.reduce((total, transaction) => total + transaction.amount, 0);
  const totalBalance = accounts.reduce((total, account) => total + account.balance, 0) +
    goals.reduce((total, goal) => total + goal.saved, 0);
  const categoryTotals = categories.map((category) => ({
      category,
      amount: monthTransactions
        .filter((transaction) => transaction.category === category)
        .reduce((total, transaction) => total + transaction.amount, 0),
    }));
  const maxCategoryAmount = Math.max(...categoryTotals.map((item) => item.amount), 1);
  const cashAccounts = accounts.filter((account) => account.type === "cash");
  const cardAccounts = accounts.filter((account) => account.type === "card");
  const totalSaved = goals.reduce((total, goal) => total + goal.saved, 0);
  const recentTransactions = [...transactions].sort((first, second) =>
    `${second.date}${second.id}`.localeCompare(`${first.date}${first.id}`),
  ).slice(0, 6);
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? "Account";

  function openModal(nextModal: "transaction" | "account" | "goal" | "save", goalId?: string) {
    setFormError("");
    if (nextModal === "transaction") setTransactionType("expense");
    if (nextModal === "save") setSelectedGoalId(goalId ?? goals.find((goal) => goal.saved < goal.target)?.id ?? goals[0]?.id ?? "");
    setModal(nextModal);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!username || password.length < 8) {
      setAuthError("Use a username and a password with at least 8 characters.");
      return;
    }
    try {
      const stored = window.localStorage.getItem(credentialKey);
      if (authMode === "register") {
        if (stored) {
          setAuthError("An account already exists on this device. Please log in.");
          return;
        }
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const saltText = Array.from(salt, (byte) => byte.toString(16).padStart(2, "0")).join("");
        const hash = await passwordHash(password, salt);
        window.localStorage.setItem(credentialKey, JSON.stringify({ username, salt: saltText, hash }));
        setHasCredential(true);
        setAuthMode("login");
      } else {
        if (!stored) {
          setAuthError("No account exists yet. Register to get started.");
          return;
        }
        const credential = JSON.parse(stored) as { username: string; salt: string; hash: string };
        const salt = new Uint8Array(credential.salt.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
        if (username !== credential.username || await passwordHash(password, salt) !== credential.hash) {
          setAuthError("That username and password do not match.");
          return;
        }
      }
      window.localStorage.setItem(sessionKey, username);
      setIsReady(false);
      setActiveUser(username);
    } catch {
      setAuthError("Could not save your sign-in on this device. Check your browser storage settings.");
    }
  }

  function logOut() {
    window.localStorage.removeItem(sessionKey);
    setIsReady(false);
    setActiveUser(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const form = new FormData(event.currentTarget);

    if (modal === "account") {
      const name = String(form.get("name") ?? "").trim();
      const type = form.get("type") === "card" ? "card" : "cash";
      const balance = Number(form.get("balance"));
      if (!name) {
        setFormError("Give this account a name.");
        return;
      }
      if (!Number.isFinite(balance) || balance < 0) {
        setFormError("Enter a valid starting balance.");
        return;
      }
      setAccounts((current) => [...current, {
        id: crypto.randomUUID(),
        name,
        type,
        balance,
      }]);
      setModal(null);
      return;
    }

    if (modal === "goal") {
      const name = String(form.get("name") ?? "").trim();
      const target = Number(form.get("target"));
      if (!name || !Number.isFinite(target) || target <= 0) {
        setFormError("Add a name and a target greater than zero.");
        return;
      }
      setGoals((current) => [...current, { id: crypto.randomUUID(), name, target, saved: 0 }]);
      setModal(null);
      return;
    }

    const amount = Number(form.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter an amount greater than zero.");
      return;
    }

    const date = String(form.get("date") ?? today());
    if (modal === "save") {
      const accountId = String(form.get("accountId") ?? "");
      const goalId = String(form.get("goalId") ?? "");
      const goal = goals.find((item) => item.id === goalId);
      const source = cashAccounts.find((account) => account.id === accountId);
      if (!goal || !source) {
        setFormError("Choose a savings goal and a cash account.");
        return;
      }
      if (amount > goal.target - goal.saved) {
        setFormError("That amount is more than this goal has left to save.");
        return;
      }
      setAccounts((current) => current.map((account) =>
        account.id === accountId ? { ...account, balance: account.balance - amount } : account,
      ));
      setGoals((current) => current.map((item) => item.id === goalId ? { ...item, saved: item.saved + amount } : item));
      setTransactions((current) => [{
        id: crypto.randomUUID(), type: "saving", amount, date, accountId, goalId,
      }, ...current]);
      setModal(null);
      return;
    }

    if (transactionType === "withdrawal" || transactionType === "payment") {
      const accountId = String(form.get("accountId") ?? "");
      const destinationAccountId = String(form.get("destinationAccountId") ?? "");
      const validTransfer = transactionType === "withdrawal"
        ? cardAccounts.some((account) => account.id === accountId) && cashAccounts.some((account) => account.id === destinationAccountId)
        : cashAccounts.some((account) => account.id === accountId) && cardAccounts.some((account) => account.id === destinationAccountId);
      if (!validTransfer) {
        setFormError("Choose a valid cash account and credit card for this transfer.");
        return;
      }
      setAccounts((current) => current.map((account) => {
        if (account.id === accountId) return { ...account, balance: account.balance - amount };
        if (account.id === destinationAccountId) return { ...account, balance: account.balance + amount };
        return account;
      }));
      setTransactions((current) => [{
        id: crypto.randomUUID(), type: transactionType, amount, date, accountId, destinationAccountId,
      }, ...current]);
    } else {
      const accountId = String(form.get("accountId") ?? "");
      const category = String(form.get("category") ?? "Other") as Category;
      if (!accounts.some((account) => account.id === accountId)) {
        setFormError("Choose an account for this expense.");
        return;
      }
      setAccounts((current) => current.map((account) =>
        account.id === accountId ? { ...account, balance: account.balance - amount } : account,
      ));
      setTransactions((current) => [{
        id: crypto.randomUUID(), type: "expense", amount, date, category, accountId,
      }, ...current]);
    }
    setModal(null);
  }

  const dateLabel = currentDate ? new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric",
  }).format(new Date(`${currentDate}T12:00:00`)) : "";

  if (!authReady) {
    return <main className="auth-shell"><div className="auth-loading">Opening your pocket...</div></main>;
  }

  if (!activeUser) {
    return (
      <main className="auth-shell">
        <div className="auth-decoration auth-decoration-one" />
        <div className="auth-decoration auth-decoration-two" />
        <section className="auth-panel">
          <a className="brand auth-brand" href="#" aria-label="Pocket home">
            <span className="brand-mark">p</span><span>pocket<span className="brand-period">.</span></span>
          </a>
          <p className="eyebrow">A LITTLE SPACE FOR YOUR MONEY</p>
          <h1>{authMode === "register" ? "Make money feel simple." : "Welcome back."}</h1>
          <p className="auth-copy">{authMode === "register" ? "Set up your personal pocket and start making plans." : "Your plans and balances are right where you left them."}</p>
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <label className="field-label">Username<input name="username" autoComplete="username" placeholder="Your username" required /></label>
            <label className="field-label">Password<input name="password" type="password" autoComplete={authMode === "register" ? "new-password" : "current-password"} placeholder="At least 8 characters" minLength={8} required /></label>
            {authError && <p className="form-error" role="alert">{authError}</p>}
            <button type="submit" className="primary-button auth-submit">{authMode === "register" ? "Create my account" : "Log in"}<span>→</span></button>
          </form>
          {!hasCredential && (
            <p className="auth-switch">{authMode === "register" ? "Already have an account?" : "New around here?"}{" "}
              <button onClick={() => { setAuthError(""); setAuthMode(authMode === "register" ? "login" : "register"); }}>{authMode === "register" ? "Log in" : "Create an account"}</button>
            </p>
          )}
          <p className="auth-local-note"><span className="privacy-dot" />One-person account · stored on this device</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Pocket home">
          <span className="brand-mark">p</span>
          <span>pocket<span className="brand-period">.</span></span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <a className="nav-link nav-link-active" href="#overview"><span className="nav-dot" />Overview</a>
        <a className="nav-link" href="#activity"><span className="nav-dot" />Transactions</a>
        <div className="sidebar-rule" />
        <div className="sidebar-section-heading">
          <span>YOUR ACCOUNTS</span>
          <button className="icon-button small-plus" onClick={() => openModal("account")} aria-label="Add account" title="Add account">+</button>
        </div>
        <div className="sidebar-accounts">
          {accounts.map((account) => (
            <div className="sidebar-account" key={account.id}>
              <span className={`mini-account-icon ${account.type}`}>{account.type === "cash" ? "$" : "▤"}</span>
              <span className="sidebar-account-name">{account.name}</span>
              <span className="sidebar-account-balance">{money(account.balance)}</span>
            </div>
          ))}
          {accounts.length === 0 && <p className="sidebar-empty">No accounts yet</p>}
        </div>
        <button className="sidebar-add" onClick={() => openModal("account")}><span>+</span> Add an account</button>
        <div className="sidebar-bottom">
          <span className="privacy-dot" />
          <span>Signed in as <strong>{activeUser}</strong></span>
          <button className="logout-button" onClick={logOut}>Log out</button>
        </div>
      </aside>

      <section className="main-area" id="overview">
        <header className="topbar">
          <div className="breadcrumb">Personal <span>/</span> Overview</div>
          <div className="topbar-right">
            <div className="topbar-date"><span className="date-indicator" />{dateLabel}</div>
            <button className="topbar-logout" onClick={logOut} aria-label={`Log out ${activeUser}`}>Log out</button>
          </div>
        </header>

        <div className="dashboard-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR FINANCES, AT A GLANCE</p>
              <h1>A little more in balance.</h1>
            </div>
            <button className="primary-button" onClick={() => openModal("transaction")}>
              <span className="button-plus">+</span> Add transaction
            </button>
          </div>

          <section className="summary-grid" aria-label="Financial summary">
            <article className="summary-card balance-card">
              <div className="summary-label">TOTAL BALANCE <span className="summary-mark green-mark">$</span></div>
              <div className="summary-value">{money(totalBalance)}</div>
              <div className="summary-note">{money(totalSaved)} tucked into goals</div>
            </article>
            <article className="summary-card spending-card">
              <div className="summary-label">SPENT THIS MONTH <span className="summary-mark blue-mark">↗</span></div>
              <div className="summary-value">{money(spentThisMonth)}</div>
              <div className="summary-note">{monthTransactions.length} {monthTransactions.length === 1 ? "transaction" : "transactions"} recorded</div>
            </article>
            <article className="summary-card account-summary-card">
              <div className="summary-label">ACCOUNT MIX <span className="summary-mark blue-mark">◌</span></div>
              <div className="account-mix">
                <div><span className="mix-dot cash-dot" />Cash <strong>{cashAccounts.length}</strong></div>
                <div><span className="mix-dot card-dot" />Credit cards <strong>{cardAccounts.length}</strong></div>
              </div>
              <button className="text-action" onClick={() => openModal("account")}>Manage accounts <span>→</span></button>
            </article>
          </section>

          <section className="section-block accounts-section" aria-labelledby="accounts-title">
            <div className="section-heading">
              <div><h2 id="accounts-title">Your accounts</h2><p>Balances, all in one place</p></div>
              <button className="quiet-button" onClick={() => openModal("account")}><span>+</span> Add account</button>
            </div>
            {accounts.length > 0 ? (
              <div className="account-grid">
                {accounts.map((account, index) => (
                  <article className={`account-card account-card-${account.type}`} key={account.id}>
                    <div className="account-card-top">
                      <span className={`account-emblem emblem-${account.type}`}>{account.type === "cash" ? "$" : "▤"}</span>
                      <span className="account-type-label">{account.type === "cash" ? "CASH" : "CREDIT CARD"}</span>
                      <span className={`account-status account-status-${index % 2}`} />
                    </div>
                    <div className="account-name">{account.name}</div>
                    <div className="account-balance">{money(account.balance)}</div>
                    <div className="account-card-footer"><span>Current balance</span><span className="account-card-arrow">↗</span></div>
                  </article>
                ))}
                <button className="account-add-card" onClick={() => openModal("account")}>
                  <span className="add-card-plus">+</span><span>Add another account</span>
                </button>
              </div>
            ) : (
              <button className="empty-accounts" onClick={() => openModal("account")}>
                <span className="empty-plus">+</span><span><strong>Add your first account</strong><small>Start with cash or a credit card</small></span>
              </button>
            )}
          </section>

          <section className="section-block goals-section" aria-labelledby="goals-title">
            <div className="section-heading">
              <div><h2 id="goals-title">Little things you&apos;re saving for</h2><p>Make a plan, then watch it grow</p></div>
              <div className="goal-actions">
                {goals.length > 0 && <button className="quiet-button save-button" onClick={() => openModal("save")}><span>↗</span> Save money</button>}
                <button className="quiet-button" onClick={() => openModal("goal")}><span>+</span> New goal</button>
              </div>
            </div>
            {goals.length > 0 ? (
              <div className="goal-grid">
                {goals.map((goal, index) => {
                  const progress = Math.min((goal.saved / goal.target) * 100, 100);
                  return (
                    <article className={`goal-card goal-card-${index % 3}`} key={goal.id}>
                      <div className="goal-card-top"><span className="goal-spark">✳</span><span>{Math.round(progress)}% there</span></div>
                      <h3>{goal.name}</h3>
                      <div className="goal-progress-track"><span style={{ width: `${progress}%` }} /></div>
                      <div className="goal-amounts"><strong>{money(goal.saved)}</strong><span>of {money(goal.target)}</span></div>
                      <button className="goal-save-link" onClick={() => openModal("save", goal.id)} disabled={progress >= 100 || cashAccounts.length === 0}>
                        {progress >= 100 ? "Goal reached!" : cashAccounts.length === 0 ? "Add a cash account to save" : "Add to this goal  →"}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-goals"><span className="empty-goal-spark">✳</span><span><strong>Dreaming of something?</strong><small>Create a goal and give your savings a destination.</small></span><button className="text-action" onClick={() => openModal("goal")}>Make a goal <span>→</span></button></div>
            )}
          </section>

          <div className="lower-grid">
            <section className="section-block activity-section" id="activity" aria-labelledby="activity-title">
              <div className="section-heading activity-heading">
                <div><h2 id="activity-title">Recent activity</h2><p>Your latest money moves</p></div>
                <button className="quiet-button" onClick={() => openModal("transaction")}><span>+</span> Add</button>
              </div>
              {recentTransactions.length > 0 ? (
                <div className="activity-list">
                  {recentTransactions.map((transaction) => {
                    const isWithdrawal = transaction.type === "withdrawal";
                    const isPayment = transaction.type === "payment";
                    const isSaving = transaction.type === "saving";
                    const isTransfer = isWithdrawal || isPayment;
                    return (
                      <article className="activity-row" key={transaction.id}>
                        <span className={`activity-icon ${isTransfer ? "transfer-icon" : isSaving ? "saving-icon" : `category-${transaction.category?.toLowerCase() ?? "other"}`}`}>
                          {isTransfer ? "↗" : isSaving ? "✳" : transaction.category?.slice(0, 1) ?? "O"}
                        </span>
                        <div className="activity-detail">
                          <strong>{isWithdrawal ? "Cash withdrawal" : isPayment ? "Credit card payment" : isSaving ? `Saved: ${goals.find((goal) => goal.id === transaction.goalId)?.name ?? "Savings goal"}` : transaction.category}</strong>
                          <span>{isTransfer
                            ? `${accountName(transaction.accountId)} to ${accountName(transaction.destinationAccountId ?? "")}`
                            : `${accountName(transaction.accountId)} · ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${transaction.date}T12:00:00`))}`}</span>
                        </div>
                        <div className="activity-amount">
                          <strong className={isTransfer ? "transfer-amount" : isSaving ? "saving-amount" : "expense-amount"}>{isSaving ? "+" : "−"}{money(transaction.amount)}</strong>
                          <span>{isTransfer ? "Transfer" : isSaving ? "Saved" : "Expense"}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-activity">
                  <span className="empty-activity-icon">↗</span>
                  <strong>No activity just yet</strong>
                  <span>Your spending will show up here.</span>
                  <button className="text-action" onClick={() => openModal("transaction")}>Add your first transaction <span>→</span></button>
                </div>
              )}
            </section>

              <section className="section-block spending-section" aria-labelledby="spending-title">
              <div className="section-heading spending-heading">
                <div><h2 id="spending-title">Spending by category</h2><p>This month</p></div>
                <span className="month-chip">{currentDate ? new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(`${currentDate}T12:00:00`)) : ""}</span>
              </div>
              <div className="category-chart">
                {categoryTotals.map(({ category, amount }) => (
                  <div className="category-row" key={category}>
                    <div className="category-row-label"><span className={`category-dot dot-${category.toLowerCase()}`} />{category}<strong>{money(amount)}</strong></div>
                    <div className="category-track"><span className={`category-fill fill-${category.toLowerCase()}`} style={{ width: `${amount ? Math.max((amount / maxCategoryAmount) * 100, 5) : 0}%` }} /></div>
                  </div>
                ))}
              </div>
              <button className="category-footer" onClick={() => openModal("transaction")}>Track a purchase <span>→</span></button>
            </section>
          </div>
          <footer className="page-footer"><span>POCKET <i>·</i> YOUR MONEY, YOUR WAY</span><span>Balances update as you log activity</span></footer>
        </div>
      </section>

      {modal && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setModal(null);
        }}>
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{modal === "account" ? "YOUR MONEY, ORGANIZED" : modal === "goal" || modal === "save" ? "SMALL STEPS, BIG PLANS" : "KEEP YOUR BALANCE CLOSE"}</p>
                <h2 id="modal-title">{modal === "account" ? "Add an account" : modal === "goal" ? "Make a savings goal" : modal === "save" ? "Add to your savings" : transactionType === "expense" ? "Add a transaction" : transactionType === "payment" ? "Pay a credit card" : "Move card money to cash"}</h2>
              </div>
              <button className="modal-close" onClick={() => setModal(null)} aria-label="Close dialog">×</button>
            </div>

            {modal === "transaction" && (
              <div className="mode-switch" role="group" aria-label="Transaction type">
                <button className={transactionType === "expense" ? "mode-active" : ""} onClick={() => { setTransactionType("expense"); setFormError(""); }}>Expense</button>
                <button className={transactionType === "withdrawal" ? "mode-active" : ""} onClick={() => { setTransactionType("withdrawal"); setFormError(""); }}>Card to cash</button>
                <button className={transactionType === "payment" ? "mode-active" : ""} onClick={() => { setTransactionType("payment"); setFormError(""); }}>Pay card</button>
              </div>
            )}

            <form className="modal-form" onSubmit={handleSubmit}>
              {modal === "account" ? (
                <>
                  <label className="field-label">Account name<input name="name" placeholder="e.g. Everyday cash" autoFocus required /></label>
                  <label className="field-label">Account type<select name="type" defaultValue="cash"><option value="cash">Cash</option><option value="card">Credit card</option></select></label>
                  <label className="field-label">Current balance <span className="input-wrap"><span>$</span><input name="balance" type="number" min="0" step="0.01" defaultValue="0" required /></span></label>
                </>
              ) : modal === "goal" ? (
                <>
                  <label className="field-label">What are you saving for?<input name="name" placeholder="e.g. Weekend away" autoFocus required /></label>
                  <label className="field-label">Savings target <span className="input-wrap"><span>$</span><input name="target" type="number" min="0.01" step="0.01" placeholder="500.00" required /></span></label>
                </>
              ) : modal === "save" ? (
                <>
                  <label className="field-label">Savings goal<select name="goalId" defaultValue={selectedGoalId} required>{goals.map((goal) => <option value={goal.id} key={goal.id} disabled={goal.saved >= goal.target}>{goal.name} · {money(goal.target - goal.saved)} left</option>)}</select></label>
                  <label className="field-label">Amount <span className="input-wrap"><span>$</span><input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" autoFocus required /></span></label>
                  <label className="field-label">Take it from<select name="accountId" defaultValue={cashAccounts[0]?.id ?? ""} required>{cashAccounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
                  <label className="field-label">Date<input name="date" type="date" defaultValue={today()} required /></label>
                </>
              ) : (
                <>
                  <label className="field-label">Amount <span className="input-wrap"><span>$</span><input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" autoFocus required /></span></label>
                  <label className="field-label">Date<input name="date" type="date" defaultValue={today()} required /></label>
                  {transactionType === "expense" ? (
                    <>
                      <label className="field-label">Category<select name="category" defaultValue="Food">{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                      <label className="field-label">Paid from<select name="accountId" defaultValue={accounts[0]?.id ?? ""} required>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.type === "cash" ? "Cash" : "Credit card"}</option>)}</select></label>
                    </>
                  ) : (
                    <>
                      <label className="field-label">{transactionType === "payment" ? "Pay from cash" : "Withdraw from card"}<select key={`source-${transactionType}`} name="accountId" defaultValue={transactionType === "payment" ? cashAccounts[0]?.id ?? "" : cardAccounts[0]?.id ?? ""} required><option value="">Choose an account</option>{(transactionType === "payment" ? cashAccounts : cardAccounts).map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                      <label className="field-label">{transactionType === "payment" ? "Add to credit card" : "Add to cash"}<select key={`destination-${transactionType}`} name="destinationAccountId" defaultValue={transactionType === "payment" ? cardAccounts[0]?.id ?? "" : cashAccounts[0]?.id ?? ""} required><option value="">Choose an account</option>{(transactionType === "payment" ? cardAccounts : cashAccounts).map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                    </>
                  )}
                </>
              )}
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="cancel-button" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="primary-button">{modal === "account" ? "Save account" : modal === "goal" ? "Create goal" : modal === "save" ? "Save money" : transactionType === "expense" ? "Save transaction" : transactionType === "payment" ? "Pay card" : "Move to cash"}</button>
              </div>
            </form>
            {modal === "transaction" && transactionType !== "expense" && (
              <p className="transfer-note">{transactionType === "payment" ? "The amount is taken from cash and added to your card balance." : "The amount is added to cash and deducted from the card balance."}</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
