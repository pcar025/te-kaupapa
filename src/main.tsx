import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
document.title = "Talkscape | Te Kaupapa";
const favicon =
  document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
  document.createElement("link");

favicon.rel = "icon";
favicon.type = "image/svg+xml";
favicon.href = "/favicon.svg";

if (!favicon.parentNode) {
  document.head.appendChild(favicon);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
