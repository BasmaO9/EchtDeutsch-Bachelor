import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import LearningMaterials from './pages/LearningMaterials';
import Evaluation from './pages/Evaluation';
import Onboarding from './pages/Onboarding';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';
import { ReportProvider } from './contexts/ReportContext';
import { authService } from './services/auth';
import './App.css';

function App() {
  return (
    <ReportProvider>
      <Router>
        <Routes>
          <Route 
            path="/" 
            element={
              authService.isAuthenticated() ? <Navigate to="/dashboard" replace /> : <Login />
            } 
          />
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/login" 
            element={
              authService.isAuthenticated() ? <Navigate to="/dashboard" replace /> : <Login />
            } 
          />
          <Route 
            path="/learning/:id" 
            element={
              <ProtectedRoute>
                <LearningMaterials />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/evaluation/:id" 
            element={
              <ProtectedRoute>
                <Evaluation />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/onboarding" 
            element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            } 
          />
        </Routes>
      </Router>
    </ReportProvider>
  );
}

export default App;
