import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WalletProvider } from "@/context/WalletContext";
import { Layout } from "@/components/Layout";
import LandingPage from "@/pages/LandingPage";
import Dashboard from "@/pages/Dashboard";
import AccountSetup from "@/pages/AccountSetup";
import Vault from "@/pages/Vault";
import Lending from "@/pages/Lending";
import Paymaster from "@/pages/Paymaster";
import SessionKeys from "@/pages/SessionKeys";

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Routes>
          {/* Landing page — outside the app shell */}
          <Route path="/" element={<LandingPage />} />

          {/* App shell — all dApp routes under /app */}
          <Route path="/app" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="account" element={<AccountSetup />} />
            <Route path="vault" element={<Vault />} />
            <Route path="lending" element={<Lending />} />
            <Route path="paymaster" element={<Paymaster />} />
            <Route path="session-keys" element={<SessionKeys />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  );
}
