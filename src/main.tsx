import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './style.css'

const container = document.getElementById('root');

if (!container) {
  throw new Error(
    "Failed to find the root element. Make sure index.html has <div id='root'></div>"
  );
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)