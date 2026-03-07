import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WalletProvider } from "@/context/WalletContext";
import { Layout } from "@/components/Layout";
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
          <Route element={<Layout />}>
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
