
/**
 * Initializes the chatbot by injecting the script tag.
 * This should only be called when the user is authenticated.
 * @param {string} [userName] - The name of the authenticated user
 */
export function initChatbot(userName) {
  if (document.getElementById('chatbot-script')) return; // Already injected

  const script = document.createElement('script');
  script.id = 'chatbot-script';
  script.defer = true;
  
  // Determine the path to chatbot.js
  // Assuming we are in html/analyse-1/ or html/analyse-1-semestre/
  // and js/ is in ../js/
  script.src = "../js/chatbot.js";
  
  // Configuration
  script.dataset.webhook = "https://botafogo.epfl.ch/n8n/webhook/d1022362-c8df-4bcb-bd18-f95d1a7d024e";
  script.dataset.title = "Chatbot";
  script.dataset.placeholder = "Start new chat";
  script.dataset.buttontext = "Send";
  script.dataset.accent = "#6366f1";
  script.dataset.fullscreen = "0";
  script.dataset.timestamps = "1";
  script.dataset.maxwidth = "840";
  script.dataset.bottomoffset = "64";
  script.dataset.defaultanswer = "hints";
  if (userName) script.dataset.username = userName;
  
  document.body.appendChild(script);
}
