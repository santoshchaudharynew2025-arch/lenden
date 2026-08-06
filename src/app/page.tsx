'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/db'
import bcrypt from 'bcryptjs'

interface User { id: string; email: string; name: string; phone?: string }
interface Person { id: string; name: string; phone: string; fatherName?: string; address?: string; relation?: string; aadharNo?: string; occupation?: string; notes?: string }
interface Payment { id: string; transactionId: string; amount: number; principalPart: number; interestPart: number; date: string; notes?: string }
interface Transaction { id: string; type: string; personId: string; person: Person; principalAmount: number; interestRate: number; interestType: string; startDate: string; dueDate?: string; status: string; description?: string; settledAt?: string; payments?: Payment[]; dailyInterest?: number; monthlyInterest?: number; totalInterestAccrued?: number; totalInterestPaid?: number; totalPrincipalPaid?: number; totalPaid?: number; pendingInterest?: number; pendingPrincipal?: number; totalDue?: number; currentPrincipal?: number; daysElapsed?: number }
interface DashboardSummary { totalLent: number; totalBorrowed: number; totalLentInterest: number; totalBorrowedInterest: number; totalPaidLent: number; totalPaidBorrowed: number; activeLoans: number; settledLoans: number; netBalance: number }

type View = 'auth' | 'dashboard' | 'people' | 'add-person' | 'add-transaction' | 'transaction-detail' | 'profile' | 'history'

const fmt = (n: number) => new Intl.NumberFormat('hi-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (d: string) => new Date(d).toLocaleDateString('hi-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function calculateInterest(tx: { principalAmount: number; interestRate: number; interestType: string; startDate: string; payments: { principalPart: number; interestPart: number; amount: number; date: string }[] }) {
  const now = new Date()
  const start = new Date(tx.startDate); start.setHours(0, 0, 0, 0)
  const daysElapsed = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000))
  const sorted = [...tx.payments].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  let totalInterestAccrued = 0, currentPrincipal = tx.principalAmount, prevDate = start
  const getDailyRate = (p: number) => tx.interestType === 'DAILY' ? (p * tx.interestRate) / 100 : (p * tx.interestRate) / 3000
  sorted.forEach(pay => {
    const payDate = new Date(pay.date); payDate.setHours(0, 0, 0, 0)
    const days = Math.max(0, Math.floor((payDate.getTime() - prevDate.getTime()) / 86400000))
    totalInterestAccrued += getDailyRate(currentPrincipal) * days
    if (pay.principalPart > 0) currentPrincipal = Math.max(0, currentPrincipal - pay.principalPart)
    prevDate = payDate
  })
  const remDays = Math.max(0, Math.floor((now.getTime() - prevDate.getTime()) / 86400000))
  totalInterestAccrued += getDailyRate(currentPrincipal) * remDays
  const totalInterestPaid = tx.payments.reduce((s, p) => s + p.interestPart, 0)
  const totalPrincipalPaid = tx.payments.reduce((s, p) => s + p.principalPart, 0)
  const totalPaid = tx.payments.reduce((s, p) => s + p.amount, 0)
  const r = (n: number) => Math.round(n * 100) / 100
  return { daysElapsed, dailyInterest: r(getDailyRate(currentPrincipal)), monthlyInterest: r(getDailyRate(currentPrincipal) * 30), totalInterestAccrued: r(totalInterestAccrued), totalInterestPaid: r(totalInterestPaid), totalPrincipalPaid: r(totalPrincipalPaid), totalPaid: r(totalPaid), pendingInterest: r(Math.max(0, totalInterestAccrued - totalInterestPaid)), pendingPrincipal: r(Math.max(0, tx.principalAmount - totalPrincipalPaid)), totalDue: r(Math.max(0, tx.principalAmount - totalPrincipalPaid + totalInterestAccrued - totalInterestPaid)), currentPrincipal: r(currentPrincipal) }
}

export default function Home() {
  const [view, setView] = useState<View>('auth')
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const checkAuth = useCallback(async () => {
    try {
      const saved = localStorage.getItem('lenden_user')
      if (saved) { const u = JSON.parse(saved); setUser(u); setView('dashboard') }
    } catch {} finally {
      setTimeout(() => setChecking(false), 2500)
    }
  }, [])
  useEffect(() => { checkAuth() }, [checkAuth])

  const loadDashboard = useCallback(async () => {
    if (!user) return
    try {
      const { data: txns } = await supabase.from('Transaction').select('*, person:Person(*)').eq('userId', user.id).order('createdAt', { ascending: false })
      const { data: allPayments } = await supabase.from('Payment').select('*').eq('userId', user.id)
      const paymentMap: Record<string, Payment[]> = {}
      ;(allPayments || []).forEach((p: Record<string, unknown>) => { const tid = p.transactionId as string; if (!paymentMap[tid]) paymentMap[tid] = []; paymentMap[tid].push(p as Payment) })

      let totalLent = 0, totalBorrowed = 0, totalLentInterest = 0, totalBorrowedInterest = 0, totalPaidLent = 0, totalPaidBorrowed = 0, activeLoans = 0, settledLoans = 0
      const details = (txns || []).map((t: Record<string, unknown>) => {
        const payments = (paymentMap[t.id as string] || []).map((p) => ({ principalPart: Number(p.principalPart || 0), interestPart: Number(p.interestPart || 0), amount: Number(p.amount || 0), date: p.date as string }))
        const calc = calculateInterest({ principalAmount: Number(t.principalAmount), interestRate: Number(t.interestRate), interestType: t.interestType as string, startDate: t.startDate as string, payments })
        const amt = Number(t.principalAmount)
        if (t.type === 'LENT') { totalLent += amt; totalLentInterest += calc.pendingInterest; totalPaidLent += calc.totalPaid }
        else { totalBorrowed += amt; totalBorrowedInterest += calc.pendingInterest; totalPaidBorrowed += calc.totalPaid }
        if (t.status === 'ACTIVE') activeLoans++; else settledLoans++
        return { ...t, person: t.person as Person, payments, ...calc } as Transaction
      })

      const r = (n: number) => Math.round(n * 100) / 100
      setSummary({ totalLent: r(totalLent), totalBorrowed: r(totalBorrowed), totalLentInterest: r(totalLentInterest), totalBorrowedInterest: r(totalBorrowedInterest), totalPaidLent: r(totalPaidLent), totalPaidBorrowed: r(totalPaidBorrowed), activeLoans, settledLoans, netBalance: r(totalLent + totalLentInterest - totalBorrowed - totalBorrowedInterest) })
      setTransactions(details)
    } catch (e) { console.error('Dashboard error:', e) }
  }, [user])

  const loadPeople = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await supabase.from('Person').select('*').eq('userId', user.id).order('createdAt', { ascending: false })
      setPeople((data || []) as Person[])
    } catch (e) { console.error('People error:', e) }
  }, [user])

  useEffect(() => { if (user && view === 'dashboard') { loadDashboard(); loadPeople() } }, [user, view, loadDashboard, loadPeople])

  const login = async (email: string, password: string) => {
    try {
      const { data: dbUser, error } = await supabase.from('User').select('*').eq('email', email).single()
      if (error || !dbUser) { showToast('यूजर नहीं मिला। कृपया पहले अकाउंट बनाएं।'); return }
      if (!dbUser.password) { showToast('यह अकाउंट Google/Facebook से बना है।'); return }
      const isValid = await bcrypt.compare(password, dbUser.password as string)
      if (!isValid) { showToast('गलत पासवर्ड'); return }
      const u = { id: dbUser.id as string, email: dbUser.email as string, name: dbUser.name as string, phone: dbUser.phone as string }
      localStorage.setItem('lenden_user', JSON.stringify(u))
      setUser(u); setView('dashboard'); showToast('लॉगिन सफल!')
    } catch { showToast('लॉगिन विफल') }
  }

  const register = async (name: string, email: string, password: string, phone: string) => {
    try {
      const { data: existing } = await supabase.from('User').select('id').eq('email', email).single()
      if (existing) { showToast('यह ईमेल पहले से रजिस्टर है। लॉगिन करें।'); return }
      const hashedPassword = await bcrypt.hash(password, 10)
      const { error } = await supabase.from('User').insert({ name, email, password: hashedPassword, phone: phone || null })
      if (error) { showToast('रजिस्ट्रेशन विफल'); return }
      showToast('रजिस्ट्रेशन सफल! लॉगिन करें।')
    } catch { showToast('रजिस्ट्रेशन विफल') }
  }

  const socialLogin = async (provider: string) => {
    try {
      const email = provider === 'google' ? 'google_user@lenden.app' : 'facebook_user@lenden.app'
      const name = provider === 'google' ? 'Google यूज़र' : 'Facebook यूज़र'
      let { data: dbUser } = await supabase.from('User').select('*').eq('email', email).single()
      if (!dbUser) { const { data: newUser } = await supabase.from('User').insert({ name, email }).select('*').single(); dbUser = newUser }
      if (!dbUser) { showToast('यूज़र बनाने में त्रुटि'); return }
      const u = { id: dbUser.id as string, email: dbUser.email as string, name: dbUser.name as string }
      localStorage.setItem('lenden_user', JSON.stringify(u))
      setUser(u); setView('dashboard'); showToast('लॉगिन सफल!')
    } catch { showToast('लॉगिन विफल') }
  }

  const resetPassword = async (email: string, phone: string, newPassword: string): Promise<boolean> => {
    try {
      const { data: dbUser } = await supabase.from('User').select('*').eq('email', email).single()
      if (!dbUser) { showToast('यह ईमेल रजिस्टर नहीं है'); return false }
      if (!dbUser.phone || dbUser.phone !== phone) { showToast('मोबाइल नंबर मेल नहीं खाता'); return false }
      if (newPassword.length < 6) { showToast('पासवर्ड कम से कम 6 अक्षर का'); return false }
      const hashedPassword = await bcrypt.hash(newPassword, 10)
      const { error } = await supabase.from('User').update({ password: hashedPassword }).eq('id', dbUser.id)
      if (error) { showToast('पासवर्ड बदलने में त्रुटि'); return false }
      showToast('पासवर्ड बदल गया! लॉगिन करें।')
      return true
    } catch { showToast('त्रुटि'); return false }
  }

  const logout = () => { localStorage.removeItem('lenden_user'); setUser(null); setView('auth'); setSummary(null); setTransactions([]); setPeople([]) }

  const addPerson = async (person: Partial<Person>) => {
    try {
      const { data, error } = await supabase.from('Person').insert({ name: person.name, phone: person.phone, fatherName: person.fatherName || null, address: person.address || null, relation: person.relation || null, aadharNo: person.aadharNo || null, occupation: person.occupation || null, notes: person.notes || null, userId: user!.id }).select('*').single()
      if (error || !data) { showToast('त्रुटि'); return }
      showToast('व्यक्ति जोड़ा गया!'); setView('people'); loadPeople()
    } catch { showToast('त्रुटि') }
  }

  const addTransaction = async (txn: Record<string, unknown>) => {
    try {
      const { data: personCheck } = await supabase.from('Person').select('id').eq('id', txn.personId).eq('userId', user!.id).single()
      if (!personCheck) { showToast('व्यक्ति नहीं मिला'); return }
      const { data, error } = await supabase.from('Transaction').insert({ type: txn.type, personId: txn.personId, principalAmount: parseFloat(String(txn.principalAmount)), interestRate: parseFloat(String(txn.interestRate)), interestType: txn.interestType, startDate: new Date(String(txn.startDate)).toISOString(), dueDate: txn.dueDate ? new Date(String(txn.dueDate)).toISOString() : null, description: txn.description || null, status: 'ACTIVE', userId: user!.id }).select('*').single()
      if (error || !data) { showToast('त्रुटि'); return }
      showToast('लेनदेन जोड़ा गया!'); setView('dashboard'); loadDashboard()
    } catch { showToast('त्रुटि') }
  }

  const addPayment = async (payment: Record<string, unknown>) => {
    try {
      const { data: txn } = await supabase.from('Transaction').select('*').eq('id', payment.transactionId).eq('userId', user!.id).single()
      if (!txn) { showToast('लेनदेन नहीं मिला'); return }
      const { data: payData, error } = await supabase.from('Payment').insert({ transactionId: payment.transactionId, amount: parseFloat(String(payment.amount)), principalPart: parseFloat(String(payment.principalPart)) || 0, interestPart: parseFloat(String(payment.interestPart)) || 0, date: new Date(String(payment.date)).toISOString(), notes: payment.notes || null, userId: user!.id }).select('*').single()
      if (error || !payData) { showToast('त्रुटि'); return }
      const { data: allPayments } = await supabase.from('Payment').select('principalPart').eq('transactionId', payment.transactionId)
      const totalPrincipalPaid = (allPayments || []).reduce((sum: number, p: Record<string, unknown>) => sum + Number(p.principalPart || 0), 0)
      if (totalPrincipalPaid >= Number(txn.principalAmount)) {
        await supabase.from('Transaction').update({ status: 'SETTLED' }).eq('id', payment.transactionId)
      }
      showToast('भुगतान जोड़ा गया!'); loadDashboard()
      if (selectedTransaction) {
        const { data: dTxns } = await supabase.from('Transaction').select('*, person:Person(*)').eq('id', selectedTransaction.id).single()
        const { data: dPays } = await supabase.from('Payment').select('*').eq('transactionId', selectedTransaction.id)
        if (dTxns) {
          const payments = (dPays || []).map((p: Record<string, unknown>) => ({ principalPart: Number(p.principalPart || 0), interestPart: Number(p.interestPart || 0), amount: Number(p.amount || 0), date: p.date as string }))
          const calc = calculateInterest({ principalAmount: Number(dTxns.principalAmount), interestRate: Number(dTxns.interestRate), interestType: dTxns.interestType as string, startDate: dTxns.startDate as string, payments })
          setSelectedTransaction({ ...dTxns, person: dTxns.person as Person, payments, ...calc } as Transaction)
        }
      }
    } catch { showToast('त्रुटि') }
  }

  // ========== SPLASH SCREEN ==========
  if (checking) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <div className="mb-8">
        <img src="/logo.png" alt="लेनदेन" className="w-36 h-36 object-contain" />
      </div>
      <div className="text-3xl font-bold text-slate-800 tracking-wide mb-1">लेनदेन</div>
      <div className="text-slate-400 text-base mb-8">हिसाब प्रबंधन ऐप</div>
      <div className="w-48 h-1 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-amber-500 rounded-full" style={{ animation: 'loadbar 2s ease-in-out infinite' }} />
      </div>
      <style>{`@keyframes loadbar { 0%{width:0%;margin-left:0} 50%{width:60%;margin-left:20%} 100%{width:0%;margin-left:100%} }`}</style>
    </div>
  )

  if (view === 'auth') return <AuthForm onLogin={login} onRegister={register} onSocial={socialLogin} onResetPassword={resetPassword} />

  // ========== MAIN APP ==========
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Toast */}
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-white px-5 py-2.5 rounded-lg font-medium shadow-lg">{toast}</div>}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="लेनदेन" className="w-9 h-9 object-contain rounded-lg" />
            <h1 className="text-lg font-bold text-slate-800">लेनदेन</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 hidden sm:block">{user?.name}</span>
            <button onClick={logout} className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition">लॉगआउट</button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="sticky top-[49px] z-30 bg-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto py-2">
          {[
            { v: 'dashboard' as View, l: 'डैशबोर्ड', icon: '📊' },
            { v: 'people' as View, l: 'लोग', icon: '👥' },
            { v: 'add-transaction' as View, l: 'लेनदेन', icon: '➕' },
            { v: 'history' as View, l: 'इतिहास', icon: '📋' },
            { v: 'profile' as View, l: 'प्रोफ़ाइल', icon: '👤' }
          ].map(item => (
            <button key={item.v} onClick={() => setView(item.v)} className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${view === item.v ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
              {item.icon} {item.l}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {view === 'dashboard' && <DashboardView summary={summary} transactions={transactions} onViewTx={(t) => { setSelectedTransaction(t); setView('transaction-detail') }} />}
        {view === 'people' && <PeopleView people={people} onAdd={() => setView('add-person')} />}
        {view === 'add-person' && <AddPersonForm onSubmit={addPerson} onCancel={() => setView('people')} />}
        {view === 'add-transaction' && <AddTransactionForm people={people} onSubmit={addTransaction} onCancel={() => setView('dashboard')} onAddPerson={() => setView('add-person')} />}
        {view === 'transaction-detail' && selectedTransaction && <TransactionDetailView transaction={selectedTransaction} onAddPayment={addPayment} onBack={() => setView('dashboard')} />}
        {view === 'history' && <HistoryView transactions={transactions} onViewTx={(t) => { setSelectedTransaction(t); setView('transaction-detail') }} />}
        {view === 'profile' && <ProfileView user={user} />}
      </main>
    </div>
  )
}

// ========== AUTH FORM ==========
function AuthForm({ onLogin, onRegister, onSocial, onResetPassword }: { onLogin: (e: string, p: string) => void; onRegister: (n: string, e: string, p: string, ph: string) => void; onSocial: (p: string) => void; onResetPassword: (e: string, ph: string, np: string) => Promise<boolean> }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login')
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [phone, setPhone] = useState(''), [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setMsg('')
    try {
      if (mode === 'login') { onLogin(email, password) }
      else if (mode === 'register') { onRegister(name, email, password, phone) }
      else if (mode === 'reset') {
        const ok = await onResetPassword(email, phone, newPassword)
        if (ok) { setMsg('पासवर्ड बदल गया! लॉगिन करें।'); setMode('login') }
      }
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo & Title */}
        <div className="text-center mb-6">
          <img src="/logo.png" alt="लेनदेन" className="w-24 h-24 object-contain mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-slate-800">लेनदेन</h1>
          <p className="text-slate-400 text-sm mt-1">हिसाब प्रबंधन ऐप</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl p-5 shadow-lg border border-slate-100">
          {/* Tabs */}
          <div className="flex gap-1 mb-5 bg-slate-100 rounded-xl p-1">
            <button onClick={() => { setMode('login'); setMsg('') }} className={`flex-1 py-2 rounded-lg font-semibold text-sm transition ${mode === 'login' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>लॉगिन</button>
            <button onClick={() => { setMode('register'); setMsg('') }} className={`flex-1 py-2 rounded-lg font-semibold text-sm transition ${mode === 'register' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>रजिस्टर</button>
            <button onClick={() => { setMode('reset'); setMsg('') }} className={`flex-1 py-2 rounded-lg font-semibold text-xs transition ${mode === 'reset' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>रीसेट</button>
          </div>

          {msg && <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm text-center">{msg}</div>}

          {/* Login Form */}
          {mode === 'login' && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ईमेल" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="पासवर्ड" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
              <button type="submit" disabled={loading} className="w-full py-3 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition disabled:opacity-50 shadow-sm">लॉगिन करें</button>
              <button type="button" onClick={() => { setMode('reset'); setMsg(''); setEmail(''); setPhone(''); setNewPassword('') }} className="w-full text-amber-600 text-sm hover:underline font-medium">पासवर्ड भूल गए?</button>
            </form>
          )}

          {/* Register Form */}
          {mode === 'register' && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="आपका नाम" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ईमेल" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="पासवर्ड (6+)" minLength={6} required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="मोबाइल नंबर" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
              <button type="submit" disabled={loading} className="w-full py-3 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition disabled:opacity-50 shadow-sm">अकाउंट बनाएं</button>
            </form>
          )}

          {/* Reset Password Form */}
          {mode === 'reset' && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm text-center">पासवर्ड रीसेट करने के लिए ईमेल और मोबाइल डालें</div>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="रजिस्टर की ईमेल *" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="रजिस्टर का मोबाइल *" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="नया पासवर्ड (6+)" minLength={6} required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
              <button type="submit" disabled={loading} className="w-full py-3 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition disabled:opacity-50 shadow-sm">{loading ? 'चेक कर रहे...' : 'पासवर्ड बदलें'}</button>
              <button type="button" onClick={() => { setMode('login'); setMsg('') }} className="w-full text-slate-500 text-sm hover:text-slate-700">← वापस लॉगिन पर</button>
            </form>
          )}

          {/* Social Login */}
          {mode !== 'reset' && (
            <div className="mt-5">
              <div className="text-center text-slate-400 text-xs mb-3">--- या ---</div>
              <div className="flex gap-3">
                <button onClick={() => onSocial('google')} className="flex-1 py-2.5 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition text-sm border border-red-100">Google</button>
                <button onClick={() => onSocial('facebook')} className="flex-1 py-2.5 bg-blue-50 text-blue-600 rounded-xl font-medium hover:bg-blue-100 transition text-sm border border-blue-100">Facebook</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ========== DASHBOARD VIEW ==========
function DashboardView({ summary, transactions, onViewTx }: { summary: DashboardSummary | null; transactions: Transaction[]; onViewTx: (t: Transaction) => void }) {
  if (!summary) return <div className="text-center text-slate-400 py-12">लोड हो रहा है...</div>
  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100"><div className="text-emerald-600 text-xs font-medium mb-1">दिया गया</div><div className="text-xl font-bold text-slate-800">{fmt(summary.totalLent)}</div></div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100"><div className="text-red-500 text-xs font-medium mb-1">लिया गया</div><div className="text-xl font-bold text-slate-800">{fmt(summary.totalBorrowed)}</div></div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100"><div className="text-amber-600 text-xs font-medium mb-1">बकाया ब्याज</div><div className="text-xl font-bold text-slate-800">{fmt(summary.totalLentInterest)}</div></div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100"><div className="text-purple-600 text-xs font-medium mb-1">शुद्ध बैलेंस</div><div className={`text-xl font-bold ${summary.netBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(summary.netBalance)}</div></div>
      </div>

      {/* Active/Settled */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-100"><div className="text-amber-600 text-xs font-medium">सक्रिय</div><div className="text-3xl font-bold text-amber-700">{summary.activeLoans}</div></div>
        <div className="bg-emerald-50 rounded-xl p-4 text-center border border-emerald-100"><div className="text-emerald-600 text-xs font-medium">पूरा</div><div className="text-3xl font-bold text-emerald-700">{summary.settledLoans}</div></div>
      </div>

      {/* Active Transactions */}
      <div>
        <h2 className="text-base font-bold text-slate-700 mb-3">सक्रिय लेनदेन</h2>
        {transactions.filter(t => t.status === 'ACTIVE').length === 0 ? <div className="text-slate-400 text-center py-8 bg-white rounded-xl border border-slate-100">कोई सक्रिय लेनदेन नहीं</div> : (
          <div className="space-y-2">{transactions.filter(t => t.status === 'ACTIVE').map(t => (
            <button key={t.id} onClick={() => onViewTx(t)} className="w-full text-left bg-white hover:bg-slate-50 rounded-xl p-4 border border-slate-100 transition shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mr-2 ${t.type === 'LENT' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{t.type === 'LENT' ? 'दिया' : 'लिया'}</span>
                  <span className="font-semibold text-slate-800">{t.person?.name}</span>
                </div>
                <div className="text-right">
                  <div className="font-bold text-slate-800">{fmt(t.principalAmount)}</div>
                  <div className="text-xs text-slate-400">{t.interestRate}% {t.interestType === 'DAILY' ? 'दैनिक' : 'मासिक'}</div>
                </div>
              </div>
              {t.totalDue !== undefined && <div className="mt-2 text-sm text-amber-600 font-medium">कुल बकाया: {fmt(t.totalDue)}</div>}
            </button>))}</div>
        )}
      </div>
    </div>
  )
}

// ========== PEOPLE VIEW ==========
function PeopleView({ people, onAdd }: { people: Person[]; onAdd: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-slate-700">लोग ({people.length})</h2>
        <button onClick={onAdd} className="px-4 py-2 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition text-sm shadow-sm">+ जोड़ें</button>
      </div>
      {people.length === 0 ? <div className="text-slate-400 text-center py-8 bg-white rounded-xl border border-slate-100">कोई व्यक्ति नहीं</div> : (
        <div className="grid gap-3 md:grid-cols-2">{people.map(p => (
          <div key={p.id} className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
            <div className="font-bold text-slate-800 text-lg">{p.name}</div>
            <div className="text-sm text-slate-500 mt-1">📱 {p.phone}</div>
            {p.fatherName && <div className="text-sm text-slate-500">👨 {p.fatherName}</div>}
            {p.address && <div className="text-sm text-slate-500">📍 {p.address}</div>}
            {p.relation && <div className="text-sm text-slate-500">🤝 {p.relation}</div>}
            {p.occupation && <div className="text-sm text-slate-500">💼 {p.occupation}</div>}
          </div>
        ))}</div>
      )}
    </div>
  )
}

// ========== ADD PERSON FORM ==========
function AddPersonForm({ onSubmit, onCancel }: { onSubmit: (p: Partial<Person>) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: '', phone: '', fatherName: '', address: '', relation: '', aadharNo: '', occupation: '', notes: '' })
  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-base font-bold text-slate-700 mb-4">नया व्यक्ति</h2>
      <form onSubmit={e => { e.preventDefault(); onSubmit(f) }} className="space-y-3 bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
        <input value={f.name} onChange={e => setF({...f, name: e.target.value})} placeholder="नाम *" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        <input value={f.phone} onChange={e => setF({...f, phone: e.target.value})} placeholder="मोबाइल *" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        <input value={f.fatherName} onChange={e => setF({...f, fatherName: e.target.value})} placeholder="पिता का नाम" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        <input value={f.address} onChange={e => setF({...f, address: e.target.value})} placeholder="पता" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        <input value={f.relation} onChange={e => setF({...f, relation: e.target.value})} placeholder="संबंध" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        <input value={f.aadharNo} onChange={e => setF({...f, aadharNo: e.target.value})} placeholder="आधार नंबर" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        <input value={f.occupation} onChange={e => setF({...f, occupation: e.target.value})} placeholder="व्यवसाय" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        <div className="flex gap-3">
          <button type="submit" className="flex-1 py-3 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition shadow-sm">जोड़ें</button>
          <button type="button" onClick={onCancel} className="px-6 py-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition">रद्द</button>
        </div>
      </form>
    </div>
  )
}

// ========== ADD TRANSACTION FORM ==========
function AddTransactionForm({ people, onSubmit, onCancel, onAddPerson }: { people: Person[]; onSubmit: (t: Record<string, unknown>) => void; onCancel: () => void; onAddPerson: () => void }) {
  const [f, setF] = useState({ type: 'LENT', personId: '', principalAmount: '', interestRate: '', interestType: 'MONTHLY', startDate: new Date().toISOString().split('T')[0], dueDate: '', description: '' })
  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-base font-bold text-slate-700 mb-4">नया लेनदेन</h2>
      {people.length === 0 ? <div className="text-center py-8 bg-white rounded-xl border border-slate-100"><p className="text-slate-500 mb-4">पहले व्यक्ति जोड़ें</p><button onClick={onAddPerson} className="px-6 py-3 bg-amber-500 text-white font-bold rounded-xl">व्यक्ति जोड़ें</button></div> :
      <form onSubmit={e => { e.preventDefault(); onSubmit(f) }} className="space-y-3 bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
        <div className="flex gap-2">
          <button type="button" onClick={() => setF({...f, type: 'LENT'})} className={`flex-1 py-3 rounded-xl font-bold transition text-sm ${f.type === 'LENT' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500'}`}>दिया गया</button>
          <button type="button" onClick={() => setF({...f, type: 'BORROWED'})} className={`flex-1 py-3 rounded-xl font-bold transition text-sm ${f.type === 'BORROWED' ? 'bg-red-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500'}`}>लिया गया</button>
        </div>
        <select value={f.personId} onChange={e => setF({...f, personId: e.target.value})} required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-amber-500"><option value="">व्यक्ति चुनें *</option>{people.map(p => <option key={p.id} value={p.id}>{p.name} ({p.phone})</option>)}</select>
        <input type="number" value={f.principalAmount} onChange={e => setF({...f, principalAmount: e.target.value})} placeholder="मूलधन (₹) *" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500" />
        <input type="number" step="0.1" value={f.interestRate} onChange={e => setF({...f, interestRate: e.target.value})} placeholder="ब्याज दर (%) *" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500" />
        <div className="flex gap-2">
          <button type="button" onClick={() => setF({...f, interestType: 'MONTHLY'})} className={`flex-1 py-3 rounded-xl font-bold transition text-sm ${f.interestType === 'MONTHLY' ? 'bg-amber-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500'}`}>मासिक %</button>
          <button type="button" onClick={() => setF({...f, interestType: 'DAILY'})} className={`flex-1 py-3 rounded-xl font-bold transition text-sm ${f.interestType === 'DAILY' ? 'bg-amber-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500'}`}>दैनिक %</button>
        </div>
        <input type="date" value={f.startDate} onChange={e => setF({...f, startDate: e.target.value})} required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-amber-500" />
        <input type="date" value={f.dueDate} onChange={e => setF({...f, dueDate: e.target.value})} placeholder="नियत तारीख" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-amber-500" />
        <textarea value={f.description} onChange={e => setF({...f, description: e.target.value})} placeholder="विवरण" rows={2} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500" />
        <div className="flex gap-3">
          <button type="submit" className="flex-1 py-3 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition shadow-sm">जोड़ें</button>
          <button type="button" onClick={onCancel} className="px-6 py-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition">रद्द</button>
        </div>
      </form>}
    </div>
  )
}

// ========== TRANSACTION DETAIL VIEW ==========
function TransactionDetailView({ transaction: t, onAddPayment, onBack }: { transaction: Transaction; onAddPayment: (p: Record<string, unknown>) => void; onBack: () => void }) {
  const [showPayForm, setShowPayForm] = useState(false)
  const [pf, setPf] = useState({ amount: '', principalPart: '', interestPart: '', date: new Date().toISOString().split('T')[0], notes: '' })
  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={onBack} className="mb-4 text-amber-600 hover:text-amber-700 font-medium">← वापस</button>

      {/* Transaction Info */}
      <div className="bg-white rounded-xl p-5 border border-slate-100 shadow-sm mb-4">
        <div className="flex items-center gap-2 mb-3">
          <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${t.type === 'LENT' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{t.type === 'LENT' ? 'दिया' : 'लिया'}</span>
          <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${t.status === 'ACTIVE' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{t.status === 'ACTIVE' ? 'सक्रिय' : 'पूरा'}</span>
        </div>
        <h2 className="text-xl font-bold text-slate-800">{t.person?.name}</h2>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div><div className="text-slate-400 text-xs">मूलधन</div><div className="text-lg font-bold text-slate-800">{fmt(t.principalAmount)}</div></div>
          <div><div className="text-slate-400 text-xs">ब्याज दर</div><div className="text-lg font-bold text-slate-800">{t.interestRate}% {t.interestType === 'DAILY' ? 'दैनिक' : 'मासिक'}</div></div>
          <div><div className="text-slate-400 text-xs">शुरू</div><div className="font-semibold text-slate-800">{fmtDate(t.startDate)}</div></div>
          <div><div className="text-slate-400 text-xs">बीते दिन</div><div className="font-semibold text-slate-800">{t.daysElapsed || 0}</div></div>
        </div>
      </div>

      {/* Interest Details */}
      <div className="bg-white rounded-xl p-5 border border-slate-100 shadow-sm mb-4">
        <h3 className="font-bold text-slate-700 mb-3">ब्याज विवरण</h3>
        <div className="grid grid-cols-2 gap-4">
          <div><div className="text-slate-400 text-xs">दैनिक ब्याज</div><div className="font-semibold text-red-600">{fmt(t.dailyInterest || 0)}</div></div>
          <div><div className="text-slate-400 text-xs">मासिक ब्याज</div><div className="font-semibold text-red-600">{fmt(t.monthlyInterest || 0)}</div></div>
          <div><div className="text-slate-400 text-xs">शेष मूलधन</div><div className="font-semibold text-red-600">{fmt(t.pendingPrincipal || 0)}</div></div>
          <div><div className="text-slate-400 text-xs">शेष ब्याज</div><div className="font-semibold text-red-600">{fmt(t.pendingInterest || 0)}</div></div>
        </div>
        <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl text-center">
          <div className="text-slate-500 text-xs">कुल बकाया</div>
          <div className="text-2xl font-bold text-red-600">{fmt(t.totalDue || 0)}</div>
        </div>
      </div>

      {/* Payments */}
      <div className="bg-white rounded-xl p-5 border border-slate-100 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-700">जमा ({t.payments?.length || 0})</h3>
          {t.status === 'ACTIVE' && <button onClick={() => setShowPayForm(!showPayForm)} className="px-4 py-2 bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-sm hover:bg-emerald-600 transition">+ जमा</button>}
        </div>

        {showPayForm && (
          <form onSubmit={e => { e.preventDefault(); onAddPayment({ ...pf, transactionId: t.id }); setShowPayForm(false); setPf({ amount: '', principalPart: '', interestPart: '', date: new Date().toISOString().split('T')[0], notes: '' }) }} className="space-y-3 mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <input type="number" value={pf.amount} onChange={e => setPf({...pf, amount: e.target.value})} placeholder="जमा राशि *" required className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500" />
            <div className="grid grid-cols-2 gap-3">
              <input type="number" value={pf.principalPart} onChange={e => setPf({...pf, principalPart: e.target.value})} placeholder="मूलधन भाग" className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500" />
              <input type="number" value={pf.interestPart} onChange={e => setPf({...pf, interestPart: e.target.value})} placeholder="ब्याज भाग" className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500" />
            </div>
            <input type="date" value={pf.date} onChange={e => setPf({...pf, date: e.target.value})} required className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-amber-500" />
            <div className="flex gap-3">
              <button type="submit" className="flex-1 py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition shadow-sm">जमा करें</button>
              <button type="button" onClick={() => setShowPayForm(false)} className="px-6 py-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition">रद्द</button>
            </div>
          </form>
        )}

        {(!t.payments || t.payments.length === 0) ? <div className="text-slate-400 text-center py-4">कोई जमा नहीं</div> : (
          <div className="space-y-2">{t.payments.map((p, i) => (
            <div key={p.id || i} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
              <div>
                <div className="text-sm text-slate-500">{fmtDate(p.date)}</div>
                {p.notes && <div className="text-xs text-slate-400">{p.notes}</div>}
              </div>
              <div className="text-right">
                <div className="font-bold text-emerald-600">{fmt(p.amount)}</div>
                <div className="text-xs text-slate-400">मूलधन: {fmt(p.principalPart)} | ब्याज: {fmt(p.interestPart)}</div>
              </div>
            </div>
          ))}</div>
        )}
      </div>
    </div>
  )
}

// ========== HISTORY VIEW ==========
function HistoryView({ transactions, onViewTx }: { transactions: Transaction[]; onViewTx: (t: Transaction) => void }) {
  return (
    <div>
      <h2 className="text-base font-bold text-slate-700 mb-4">सभी लेनदेन ({transactions.length})</h2>
      {transactions.length === 0 ? <div className="text-slate-400 text-center py-8 bg-white rounded-xl border border-slate-100">कोई लेनदेन नहीं</div> : (
        <div className="space-y-2">{transactions.map(t => (
          <button key={t.id} onClick={() => onViewTx(t)} className="w-full text-left bg-white hover:bg-slate-50 rounded-xl p-4 border border-slate-100 transition shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mr-2 ${t.type === 'LENT' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{t.type === 'LENT' ? 'दिया' : 'लिया'}</span>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mr-2 ${t.status === 'ACTIVE' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{t.status === 'ACTIVE' ? 'सक्रिय' : 'पूरा'}</span>
                <span className="font-semibold text-slate-800">{t.person?.name}</span>
              </div>
              <div className="text-right">
                <div className="font-bold text-slate-800">{fmt(t.principalAmount)}</div>
                <div className="text-xs text-slate-400">{fmtDate(t.startDate)}</div>
              </div>
            </div>
          </button>
        ))}</div>
      )}
    </div>
  )
}

// ========== PROFILE VIEW ==========
function ProfileView({ user }: { user: User | null }) {
  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-base font-bold text-slate-700 mb-4">प्रोफ़ाइल</h2>
      <div className="bg-white rounded-xl p-5 border border-slate-100 shadow-sm space-y-4">
        <div className="flex justify-center mb-4">
          <img src="/logo.png" alt="लेनदेन" className="w-20 h-20 object-contain rounded-2xl" />
        </div>
        <div><div className="text-slate-400 text-xs">नाम</div><div className="text-lg font-semibold text-slate-800">{user?.name}</div></div>
        <div><div className="text-slate-400 text-xs">ईमेल</div><div className="text-lg font-semibold text-slate-800">{user?.email}</div></div>
        <div><div className="text-slate-400 text-xs">फ़ोन</div><div className="text-lg font-semibold text-slate-800">{user?.phone || 'नहीं दिया'}</div></div>
      </div>
    </div>
  )
}
