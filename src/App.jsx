import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Planner from './pages/Planner';
import Lobby from './pages/Lobby';
import Timeline from './pages/Timeline';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Planner />} />
          <Route path="/room/:id" element={<Lobby />} />
          <Route path="/timeline/:id" element={<Timeline />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
