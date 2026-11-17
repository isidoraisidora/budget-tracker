"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSupabaseClient } from "@/lib/supabase";

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
  type: "expense" | "deposit" | "withdrawal" | "payment" | "saving";
  amount: number;
  date: string;
  category?: Category;
  accountId: string;
  destinationAccountId?: string;
  goalId?: string;
  sourceLabel?: string;
  comment?: string;
  accountNameSnapshot?: string;
  destinationAccountNameSnapshot?: string;
};

const categories: Category[] = ["Food", "Clothes", "Coffee", "Travelling", "Other"];
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const money = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Please try again.";

export default function Home() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [activeUser, setActiveUser] = useState<string | null>(null);
  const [activeEmail, setActiveEmail] = useState("");
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [dataError, setDataError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const saveQueue = useRef(Promise.resolve());
  const activeUserRef = useRef<string | null>(null);
  const [modal, setModal] = useState<"transaction" | "account" | "goal" | "save" | null>(null);
  const [activityDialogOpen, setActivityDialogOpen] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState("");
  const [transactionType, setTransactionType] = useState<"expense" | "deposit" | "withdrawal" | "payment">("expense");
  const [activeSection, setActiveSection] = useState<"overview" | "activity">("overview");
  const [selectedActivityMonth, setSelectedActivityMonth] = useState("");
  const [selectedStatisticsMonth, setSelectedStatisticsMonth] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    activeUserRef.current = activeUser;
  }, [activeUser]);

  useEffect(() => {
    let isMounted = true;
    let subscription: { unsubscribe: () => void } | undefined;
    void Promise.resolve().then(() => {
      if (!isMounted) return undefined;
      const supabase = getSupabaseClient();
      const authChange = supabase.auth.onAuthStateChange((_event, session) => {
        setIsReady(false);
        setActiveUser(session?.user.id ?? null);
        setActiveEmail(session?.user.email ?? "");
        setAuthReady(true);
      });
      subscription = authChange.data.subscription;
      return supabase.auth.getSession();
    }).then((result) => {
      if (!result || !isMounted) return;
      const { data, error } = result;
      if (error) throw error;
      setActiveUser(data.session?.user.id ?? null);
      setActiveEmail(data.session?.user.email ?? "");
      setAuthReady(true);
    }).catch((error: unknown) => {
      if (!isMounted) return;
      setAuthError(errorMessage(error));
      setAuthReady(true);
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady || !activeUser) return;
    let isMounted = true;

    async function loadBudget() {
      try {
        const supabase = getSupabaseClient();
        const [accountResult, goalResult, transactionResult] = await Promise.all([
          supabase.from("accounts").select("*").order("created_at"),
          supabase.from("goals").select("*").order("created_at"),
          supabase.from("transactions").select("*").order("date", { ascending: false }),
        ]);
        if (accountResult.error) throw accountResult.error;
        if (goalResult.error) throw goalResult.error;
        if (transactionResult.error) throw transactionResult.error;

        const savedAccounts: Account[] = accountResult.data.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          balance: Number(account.balance),
        }));
        const savedGoals: Goal[] = goalResult.data.map((goal) => ({
          id: goal.id,
          name: goal.name,
          target: Number(goal.target),
          saved: Number(goal.saved),
        }));
        const savedTransactions: Transaction[] = transactionResult.data.map((transaction) => ({
          id: transaction.id,
          type: transaction.type,
          amount: Number(transaction.amount),
          date: transaction.date,
          ...(transaction.category ? { category: transaction.category } : {}),
          accountId: transaction.account_id ?? "",
          ...(transaction.destination_account_id ? { destinationAccountId: transaction.destination_account_id } : {}),
          ...(transaction.goal_id ? { goalId: transaction.goal_id } : {}),
          ...(transaction.source_label ? { sourceLabel: transaction.source_label } : {}),
          ...(transaction.comment ? { comment: transaction.comment } : {}),
          ...(transaction.account_name_snapshot ? { accountNameSnapshot: transaction.account_name_snapshot } : {}),
          ...(transaction.destination_account_name_snapshot
            ? { destinationAccountNameSnapshot: transaction.destination_account_name_snapshot }
            : {}),
        }));

        if (!isMounted) return;
        setAccounts(savedAccounts.length ? savedAccounts : [
          { id: crypto.randomUUID(), name: "Cash", type: "cash", balance: 0 },
        ]);
        setGoals(savedGoals);
        setTransactions(savedTransactions);
        setIsReady(true);
      } catch (error) {
        if (isMounted) setDataError(errorMessage(error));
      }
    }

    void loadBudget();
    return () => {
      isMounted = false;
    };
  }, [activeUser, authReady, loadAttempt]);

  useEffect(() => {
    if (!isReady || !activeUser) return;
    const timeout = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
        if (activeUserRef.current !== activeUser) return;
        const { error } = await getSupabaseClient().rpc("save_budget_state", {
          p_accounts: accounts,
          p_goals: goals,
          p_transactions: transactions.map((transaction) => ({
            id: transaction.id,
            type: transaction.type,
            amount: transaction.amount,
            date: transaction.date,
            category: transaction.category ?? null,
            account_id: transaction.accountId || null,
            destination_account_id: transaction.destinationAccountId ?? null,
            goal_id: transaction.goalId ?? null,
            source_label: transaction.sourceLabel ?? null,
            comment: transaction.comment ?? null,
            account_name_snapshot: transaction.accountNameSnapshot ?? null,
            destination_account_name_snapshot: transaction.destinationAccountNameSnapshot ?? null,
          })),
        });
        if (error) throw error;
        setSyncError("");
      }).catch((error: unknown) => {
        setSyncError(errorMessage(error));
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [accounts, transactions, goals, isReady, activeUser, saveAttempt]);

  const currentDate = isReady ? today() : "";
  const month = currentDate.slice(0, 7);
  const monthTransactions = transactions.filter(
    (transaction) => transaction.type === "expense" && transaction.date.startsWith(month),
  );
  const spentThisMonth = monthTransactions.reduce((total, transaction) => total + transaction.amount, 0);
  const availableExpenseMonths = Array.from(new Set(
    transactions
      .filter((transaction) => transaction.type === "expense" && /^\d{4}-\d{2}-\d{2}$/.test(transaction.date))
      .map((transaction) => transaction.date.slice(0, 7)),
  ));
  const statisticsDefaultMonth = month || availableExpenseMonths[0] || "2000-01";
  if (!availableExpenseMonths.includes(statisticsDefaultMonth)) availableExpenseMonths.push(statisticsDefaultMonth);
  availableExpenseMonths.sort((first, second) => second.localeCompare(first));
  const statisticsMonth = selectedStatisticsMonth || statisticsDefaultMonth;
  const statisticsMonthTransactions = transactions.filter(
    (transaction) => transaction.type === "expense" && transaction.date.startsWith(statisticsMonth),
  );
  const statisticsMonthSpent = statisticsMonthTransactions.reduce((total, transaction) => total + transaction.amount, 0);
  const statisticsMonthDays = statisticsMonth
    ? new Date(Number(statisticsMonth.slice(0, 4)), Number(statisticsMonth.slice(5, 7)), 0).getDate()
    : 0;
  const dailyCategoryTotals = new Map<string, Map<Category, number>>();
  statisticsMonthTransactions.forEach((transaction) => {
    const categoryTotalsForDay = dailyCategoryTotals.get(transaction.date) ?? new Map<Category, number>();
    const category = transaction.category ?? "Other";
    categoryTotalsForDay.set(
      category,
      (categoryTotalsForDay.get(category) ?? 0) + transaction.amount,
    );
    dailyCategoryTotals.set(transaction.date, categoryTotalsForDay);
  });
  const dailySpending = Array.from({ length: statisticsMonthDays }, (_, index) => {
    const date = `${statisticsMonth}-${String(index + 1).padStart(2, "0")}`;
    const categoryAmounts = categories.map((category) => ({
      category,
      amount: dailyCategoryTotals.get(date)?.get(category) ?? 0,
    }));
    return {
      day: index + 1,
      categoryAmounts,
      amount: categoryAmounts.reduce((total, category) => total + category.amount, 0),
    };
  });
  const statisticsCategoryTotals = categories
    .map((category) => ({
      category,
      amount: statisticsMonthTransactions
        .filter((transaction) => (transaction.category ?? "Other") === category)
        .reduce((total, transaction) => total + transaction.amount, 0),
    }))
    .filter(({ amount }) => amount > 0);
  const maximumDailySpending = Math.max(...dailySpending.map(({ amount }) => amount), 0);
  const spendingChartScale = maximumDailySpending > 0 ? maximumDailySpending * 1.12 : 1;
  const spendingChartTicks = [0, 1, 2, 3, 4];
  const spendingChartAxisMoney = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
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
  const availableActivityMonths = Array.from(new Set([
    month,
    ...transactions
      .filter((transaction) => /^\d{4}-\d{2}-\d{2}$/.test(transaction.date))
      .map((transaction) => transaction.date.slice(0, 7)),
  ])).filter(Boolean).sort((first, second) => second.localeCompare(first));
  const activityMonth = selectedActivityMonth || month || availableActivityMonths[0] || "2000-01";
  const activityMonthTransactions = [...transactions]
    .filter((transaction) => transaction.date.startsWith(activityMonth))
    .sort((first, second) => `${second.date}${second.id}`.localeCompare(`${first.date}${first.id}`));
  const accountName = (id: string, snapshot?: string) => accounts.find((account) => account.id === id)?.name ?? snapshot ?? "Account";

  function renderActivityRows(activityItems: Transaction[]) {
    return (
      <div className="activity-list">
        {activityItems.map((transaction) => {
          const isWithdrawal = transaction.type === "withdrawal";
          const isPayment = transaction.type === "payment";
          const isSaving = transaction.type === "saving";
          const isDeposit = transaction.type === "deposit";
          const isCardTopUp = isPayment && !transaction.destinationAccountId;
          const isTransfer = isWithdrawal || (isPayment && !isCardTopUp);
          return (
            <article className="activity-row" key={transaction.id}>
              <span className={`activity-icon ${isTransfer ? "transfer-icon" : isSaving || isDeposit || isCardTopUp ? "saving-icon" : `category-${transaction.category?.toLowerCase() ?? "other"}`}`}>
                {isTransfer ? "↗" : isSaving ? "✳" : isDeposit || isCardTopUp ? "+" : transaction.category?.slice(0, 1) ?? "O"}
              </span>
              <div className="activity-detail">
                <strong>{isWithdrawal ? "Cash withdrawal" : isPayment ? "Credit card payment" : isDeposit ? "Money added" : isSaving ? `Saved: ${goals.find((goal) => goal.id === transaction.goalId)?.name ?? "Savings goal"}` : transaction.category}</strong>
                <span>{isTransfer
                  ? `${accountName(transaction.accountId, transaction.accountNameSnapshot)} to ${accountName(transaction.destinationAccountId ?? "", transaction.destinationAccountNameSnapshot)}`
                  : isSaving && transaction.sourceLabel ? transaction.sourceLabel
                  : `${accountName(transaction.accountId, transaction.accountNameSnapshot)} · ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${transaction.date}T12:00:00`))}`}</span>
                {transaction.comment && <span className="activity-comment" title={transaction.comment}>{transaction.comment}</span>}
              </div>
              <div className="activity-amount">
                <strong className={isTransfer ? "transfer-amount" : isSaving || isDeposit || isCardTopUp ? "saving-amount" : "expense-amount"}>{isSaving || isDeposit || isCardTopUp ? "+" : "−"}{money(transaction.amount)}</strong>
                <span>{isTransfer ? "Transfer" : isSaving ? "Saved" : isDeposit || isCardTopUp ? "Added" : "Expense"}</span>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  function removeAccount(account: Account) {
    if (account.type !== "card" || !window.confirm(`Remove ${account.name} from your accounts? Its balance will no longer count toward your total. Past activity will be kept.`)) return;
    setAccounts((current) => current.filter((item) => item.id !== account.id));
    setTransactions((current) => current.map((transaction) => ({
      ...transaction,
      accountNameSnapshot: transaction.accountId === account.id ? account.name : transaction.accountNameSnapshot,
      destinationAccountNameSnapshot: transaction.destinationAccountId === account.id
        ? account.name
        : transaction.destinationAccountNameSnapshot,
    })));
  }

  function openModal(nextModal: "transaction" | "account" | "goal" | "save", goalId?: string) {
    setFormError("");
    if (nextModal === "transaction") setTransactionType("expense");
    if (nextModal === "save") setSelectedGoalId(goalId ?? goals.find((goal) => goal.saved < goal.target)?.id ?? goals[0]?.id ?? "");
    setModal(nextModal);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setAuthSuccess("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!email || password.length < 8) {
      setAuthError("Enter a valid email address and a password with at least 8 characters.");
      return;
    }

    try {
      const supabase = getSupabaseClient();
      if (authMode === "register") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session && data.user) {
          setIsReady(false);
          setActiveUser(data.user.id);
          setActiveEmail(data.user.email ?? email);
        } else {
          setAuthMode("login");
          setAuthSuccess("Check your email to confirm your account, then log in.");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setIsReady(false);
        setActiveUser(data.user.id);
        setActiveEmail(data.user.email ?? email);
      }
    } catch (error) {
      setAuthError(errorMessage(error));
    }
  }

  async function logOut() {
    try {
      const { error } = await getSupabaseClient().auth.signOut();
      if (error) throw error;
      setIsReady(false);
      setActiveUser(null);
      setActiveEmail("");
    } catch (error) {
      setSyncError(errorMessage(error));
    }
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
    const comment = String(form.get("comment") ?? "").trim();
    if (modal === "save") {
      const sourceId = String(form.get("sourceId") ?? "");
      const goalId = String(form.get("goalId") ?? "");
      const goal = goals.find((item) => item.id === goalId);
      const source = accounts.find((account) => account.id === sourceId);
      if (!goal || (sourceId !== "other" && !source)) {
        setFormError("Choose a savings goal and a source.");
        return;
      }
      if (amount > goal.target - goal.saved) {
        setFormError("That amount is more than this goal has left to save.");
        return;
      }
      if (source) {
        setAccounts((current) => current.map((account) =>
          account.id === source.id ? { ...account, balance: account.balance - amount } : account,
        ));
      }
      setGoals((current) => current.map((item) => item.id === goalId ? { ...item, saved: item.saved + amount } : item));
      setTransactions((current) => [{
        id: crypto.randomUUID(), type: "saving", amount, date, accountId: source?.id ?? "", goalId,
        sourceLabel: source ? undefined : "Other source",
        ...(comment ? { comment } : {}),
      }, ...current]);
      setModal(null);
      return;
    }

    if (transactionType === "deposit") {
      const accountId = String(form.get("accountId") ?? "");
      if (!accounts.some((account) => account.id === accountId)) {
        setFormError("Choose an account to add money to.");
        return;
      }
      setAccounts((current) => current.map((account) =>
        account.id === accountId ? { ...account, balance: account.balance + amount } : account,
      ));
      setTransactions((current) => [{
        id: crypto.randomUUID(), type: "deposit", amount, date, accountId,
        ...(comment ? { comment } : {}),
      }, ...current]);
      setModal(null);
      return;
    }

    if (transactionType === "withdrawal") {
      const accountId = String(form.get("accountId") ?? "");
      const destinationAccountId = cashAccounts[0]?.id ?? "";
      if (!cardAccounts.some((account) => account.id === accountId) || !destinationAccountId) {
        setFormError("Choose a credit card and add a cash account to receive this transfer.");
        return;
      }
      setAccounts((current) => current.map((account) => {
        if (account.id === accountId) return { ...account, balance: account.balance - amount };
        if (account.id === destinationAccountId) return { ...account, balance: account.balance + amount };
        return account;
      }));
      setTransactions((current) => [{
        id: crypto.randomUUID(), type: "withdrawal", amount, date, accountId, destinationAccountId,
        ...(comment ? { comment } : {}),
      }, ...current]);
      setModal(null);
      return;
    }

    if (transactionType === "payment") {
      const accountId = String(form.get("destinationAccountId") ?? "");
      if (!cardAccounts.some((account) => account.id === accountId)) {
        setFormError("Choose a credit card to add money to.");
        return;
      }
      setAccounts((current) => current.map((account) =>
        account.id === accountId ? { ...account, balance: account.balance + amount } : account,
      ));
      setTransactions((current) => [{
        id: crypto.randomUUID(), type: "payment", amount, date, accountId,
        ...(comment ? { comment } : {}),
      }, ...current]);
      setModal(null);
      return;
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
        ...(comment ? { comment } : {}),
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
            <label className="field-label">Email<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>
            <label className="field-label">Password<input name="password" type="password" autoComplete={authMode === "register" ? "new-password" : "current-password"} placeholder="At least 8 characters" minLength={8} required /></label>
            {authError && <p className="form-error" role="alert">{authError}</p>}
            {authSuccess && <p className="auth-success" role="status">{authSuccess}</p>}
            <button type="submit" className="primary-button auth-submit">{authMode === "register" ? "Create my account" : "Log in"}<span>→</span></button>
          </form>
          <p className="auth-switch">{authMode === "register" ? "Already have an account?" : "New around here?"}{" "}
            <button onClick={() => { setAuthError(""); setAuthSuccess(""); setAuthMode(authMode === "register" ? "login" : "register"); }}>{authMode === "register" ? "Log in" : "Create an account"}</button>
          </p>
          <p className="auth-local-note"><span className="privacy-dot" />Your budget is securely synced to your Supabase database</p>
        </section>
      </main>
    );
  }

  if (!isReady) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          {dataError
            ? <>
                <p className="form-error" role="alert">Could not load your budget: {dataError}</p>
                <button className="primary-button" onClick={() => { setDataError(""); setLoadAttempt((attempt) => attempt + 1); }}>Retry</button>
                <button className="cancel-button" onClick={logOut}>Log out</button>
              </>
            : <div className="auth-loading">Loading your budget...</div>}
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
        <a className={`nav-link ${activeSection === "overview" ? "nav-link-active" : ""}`} href="#overview" onClick={() => setActiveSection("overview")}><span className="nav-dot" />Overview</a>
        <a className={`nav-link ${activeSection === "activity" ? "nav-link-active" : ""}`} href="#activity" onClick={() => setActiveSection("activity")}><span className="nav-dot" />Transactions</a>
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
          <span>Signed in as <strong>{activeEmail}</strong></span>
          <button className="logout-button" onClick={logOut}>Log out</button>
        </div>
      </aside>

      <section className="main-area" id="overview">
        <header className="topbar">
          <div className="breadcrumb">Personal <span>/</span> Overview</div>
          <div className="topbar-right">
            <div className="topbar-date"><span className="date-indicator" />{dateLabel}</div>
            <button className="topbar-logout" onClick={logOut} aria-label={`Log out ${activeEmail}`}>Log out</button>
          </div>
        </header>
        {syncError && (
          <div className="sync-error" role="alert">
            Could not save your latest changes: {syncError}
            <button onClick={() => setSaveAttempt((attempt) => attempt + 1)}>Retry save</button>
          </div>
        )}

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
                      {account.type === "card" ? (
                        <button className="account-remove-button" onClick={() => removeAccount(account)} aria-label={`Remove ${account.name}`} title="Remove credit card">×</button>
                      ) : (
                        <span className={`account-status account-status-${index % 2}`} />
                      )}
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
                      <button className="goal-save-link" onClick={() => openModal("save", goal.id)} disabled={progress >= 100}>
                        {progress >= 100 ? "Goal reached!" : "Add to this goal  →"}
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
                <div>
                  <h2 id="activity-title">Recent activity</h2>
                  <p><button className="activity-all-link" onClick={() => setActivityDialogOpen(true)} aria-haspopup="dialog" aria-controls="activity-modal">Click here to see all transactions</button></p>
                </div>
                <button className="quiet-button" onClick={() => openModal("transaction")}><span>+</span> Add</button>
              </div>
              {recentTransactions.length > 0 ? (
                renderActivityRows(recentTransactions)
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
          <section className="section-block statistics-section" aria-labelledby="statistics-title">
            <div className="section-heading statistics-heading">
              <div>
                <h2 id="statistics-title">Monthly spending</h2>
                <p>See how your expenses add up day by day</p>
              </div>
              <label className="statistics-month-picker">
                <span>Month</span>
                <select
                  aria-label="Choose a month to view"
                  value={statisticsMonth}
                  onChange={(event) => setSelectedStatisticsMonth(event.target.value)}
                >
                  {availableExpenseMonths.map((monthKey) => (
                    <option value={monthKey} key={monthKey}>
                      {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" })
                        .format(new Date(`${monthKey}-01T12:00:00`))}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="statistics-summary">
              <div><span>Total spent</span><strong>{money(statisticsMonthSpent)}</strong></div>
              <div><span>Expenses</span><strong>{statisticsMonthTransactions.length}</strong></div>
            </div>
            <div className="statistics-chart">
              <svg
                viewBox="0 0 760 260"
                role="img"
                aria-label={`${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" })
                  .format(new Date(`${statisticsMonth}-01T12:00:00`))} daily spending, totaling ${money(statisticsMonthSpent)}`}
              >
                {spendingChartTicks.map((tick) => {
                  const y = 20 + 190 - (tick / 4) * 190;
                  return (
                    <g key={tick}>
                      <line x1="58" x2="746" y1={y} y2={y} className="statistics-grid-line" />
                      <text x="49" y={y + 4} textAnchor="end" className="statistics-axis-label">
                        {spendingChartAxisMoney.format((spendingChartScale * tick) / 4)}
                      </text>
                    </g>
                  );
                })}
                {dailySpending.map(({ day, amount, categoryAmounts }) => {
                  const step = 688 / statisticsMonthDays;
                  const barWidth = Math.min(16, step * 0.58);
                  const x = 58 + (day - 1) * step + (step - barWidth) / 2;
                  const showDayLabel = [1, 5, 10, 15, 20, 25, statisticsMonthDays].includes(day);
                  return (
                    <g key={day}>
                      {categoryAmounts.map(({ category, amount: categoryAmount }, categoryIndex) => {
                        if (!categoryAmount) return null;
                        const amountBefore = categoryAmounts
                          .slice(0, categoryIndex)
                          .reduce((total, item) => total + item.amount, 0);
                        const segmentHeight = (categoryAmount / spendingChartScale) * 190;
                        const y = 210 - ((amountBefore + categoryAmount) / spendingChartScale) * 190;
                        return (
                          <rect
                            key={category}
                            x={x}
                            y={y}
                            width={barWidth}
                            height={segmentHeight}
                            rx="2"
                            className={`statistics-bar fill-${category.toLowerCase()}`}
                          >
                            <title>{`Day ${day} · ${category}: ${money(categoryAmount)}`}</title>
                          </rect>
                        );
                      })}
                      {showDayLabel && (
                        <text x={x + barWidth / 2} y="235" textAnchor="middle" className="statistics-axis-label">
                          {day}
                        </text>
                      )}
                      {amount > 0 && (
                        <title>{`Day ${day}: ${money(amount)}`}</title>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
            {statisticsCategoryTotals.length > 0 && (
              <div className="statistics-legend" aria-label="Spending by category">
                {statisticsCategoryTotals.map(({ category, amount }) => (
                  <div className="statistics-legend-item" key={category}>
                    <span className={`category-dot dot-${category.toLowerCase()}`} />
                    <span>{category}</span>
                    <strong>{money(amount)}</strong>
                  </div>
                ))}
              </div>
            )}
            {statisticsMonthTransactions.length === 0 && (
              <p className="statistics-empty">No expenses recorded for this month yet.</p>
            )}
          </section>
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
                <h2 id="modal-title">{modal === "account" ? "Add an account" : modal === "goal" ? "Make a savings goal" : modal === "save" ? "Add to your savings" : transactionType === "expense" ? "Add a transaction" : transactionType === "deposit" ? "Add money" : transactionType === "payment" ? "Pay a credit card" : "Move card money to cash"}</h2>
              </div>
              <button className="modal-close" onClick={() => setModal(null)} aria-label="Close dialog">×</button>
            </div>

            {modal === "transaction" && (
              <div className="mode-switch" role="group" aria-label="Transaction type">
                <button className={transactionType === "expense" ? "mode-active" : ""} onClick={() => { setTransactionType("expense"); setFormError(""); }}>Expense</button>
                <button className={transactionType === "deposit" ? "mode-active" : ""} onClick={() => { setTransactionType("deposit"); setFormError(""); }}>Add money</button>
                <button className={transactionType === "withdrawal" ? "mode-active" : ""} onClick={() => { setTransactionType("withdrawal"); setFormError(""); }}>Card to cash</button>
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
                  <label className="field-label">Add funds from<select name="sourceId" defaultValue={accounts[0]?.id ?? "other"} required>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.type === "cash" ? "Cash" : "Credit card"} · {money(account.balance)}</option>)}<option value="other">Other source</option></select></label>
                  <label className="field-label">Date<input name="date" type="date" defaultValue={today()} required /></label>
                  <label className="field-label">Comment (optional)<input name="comment" type="text" maxLength={200} placeholder="Add a note about this activity" /></label>
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
                  ) : transactionType === "deposit" ? (
                    <label className="field-label">Add money to<select name="accountId" defaultValue={accounts[0]?.id ?? ""} required><option value="">Choose an account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.type === "cash" ? "Cash" : "Credit card"}</option>)}</select></label>
                  ) : transactionType === "withdrawal" ? (
                    <label className="field-label">Withdraw from card<select key="withdrawal-card-source" name="accountId" defaultValue={cardAccounts[0]?.id ?? ""} required><option value="">Choose a credit card</option>{cardAccounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                  ) : (
                    <label className="field-label">Add to credit card<select key={`destination-${transactionType}`} name="destinationAccountId" defaultValue={cardAccounts[0]?.id ?? ""} required><option value="">Choose a credit card</option>{cardAccounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                  )}
                  <label className="field-label">Comment (optional)<input name="comment" type="text" maxLength={200} placeholder="Add a note about this activity" /></label>
                </>
              )}
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="cancel-button" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="primary-button">{modal === "account" ? "Save account" : modal === "goal" ? "Create goal" : modal === "save" ? "Save money" : transactionType === "expense" ? "Save transaction" : transactionType === "deposit" ? "Add money" : transactionType === "payment" ? "Pay card" : "Move to cash"}</button>
              </div>
            </form>
            {modal === "transaction" && (transactionType === "withdrawal" || transactionType === "payment") && (
              <p className="transfer-note">{transactionType === "payment" ? "The amount is added directly to the selected card; cash is unchanged." : cashAccounts[0] ? `The amount is added to ${cashAccounts[0].name} and deducted from the card balance.` : "Add a cash account to receive this transfer."}</p>
            )}
          </section>
        </div>
      )}

      {activityDialogOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setActivityDialogOpen(false);
        }}>
          <section className="modal-panel activity-modal-panel" id="activity-modal" role="dialog" aria-modal="true" aria-labelledby="activity-modal-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">YOUR MONEY, IN MOTION</p>
                <h2 id="activity-modal-title">Spending activity</h2>
              </div>
              <button className="modal-close" onClick={() => setActivityDialogOpen(false)} aria-label="Close activity history">×</button>
            </div>
            <div className="activity-modal-toolbar">
              <div className="activity-modal-summary">
                <strong>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${activityMonth}-01T12:00:00`))}</strong>
                <span>{activityMonthTransactions.length} {activityMonthTransactions.length === 1 ? "activity" : "activities"}</span>
              </div>
              <label className="activity-modal-month-picker">
                <span>Month</span>
                <select
                  aria-label="Filter activity by month"
                  value={activityMonth}
                  onChange={(event) => setSelectedActivityMonth(event.target.value)}
                >
                  {availableActivityMonths.map((availableMonth) => (
                    <option value={availableMonth} key={availableMonth}>
                      {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${availableMonth}-01T12:00:00`))}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {activityMonthTransactions.length > 0 ? (
              renderActivityRows(activityMonthTransactions)
            ) : (
              <div className="empty-activity activity-modal-empty">
                <span className="empty-activity-icon">↗</span>
                <strong>No activity this month</strong>
                <span>Your spending and other activities will show up here.</span>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
