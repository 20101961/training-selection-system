import { Routes, Route, Navigate } from 'react-router-dom';
import Protected from './components/Protected';
import Layout from './components/Layout';
import Login, { ChangePassword } from './pages/Login';
import Dashboard from './pages/Dashboard';
import BaseData from './pages/BaseData';
import Stages from './pages/Stages';
import Fill from './pages/flow/Fill';
import Interview from './pages/flow/Interview';
import CandidateLists from './pages/flow/CandidateLists';
import Confirm from './pages/flow/Confirm';
import Supplementary from './pages/flow/Supplementary';
import InternalTransfer from './pages/flow/InternalTransfer';
import Coordination from './pages/flow/Coordination';
import Publication from './pages/flow/Publication';
import Audit from './pages/flow/Audit';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route element={<Protected />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/base" element={<BaseData />} />
          <Route path="/stages" element={<Stages />} />
          <Route path="/flow/fill" element={<Fill />} />
          <Route path="/flow/interview" element={<Interview />} />
          <Route path="/flow/candidate-lists" element={<CandidateLists />} />
          <Route path="/flow/confirm" element={<Confirm />} />
          <Route path="/flow/supplementary" element={<Supplementary />} />
          <Route path="/flow/internal-transfer" element={<InternalTransfer />} />
          <Route path="/flow/coordination" element={<Coordination />} />
          <Route path="/flow/publication" element={<Publication />} />
          <Route path="/flow/audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
