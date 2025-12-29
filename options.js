// Saves options to chrome.storage
const saveOptions = () => {
  const apiKey = document.getElementById('apiKey').value;
  const anthropicApiKey = document.getElementById('anthropicApiKey').value;
  const userContext = document.getElementById('userContext').value;
  const modelSelect = document.getElementById('model').value;
  const customModel = document.getElementById('customModel').value;
  const model = modelSelect === 'custom' ? customModel : modelSelect;
  const tone = document.getElementById('tone').value;
  const exampleEmail = document.getElementById('exampleEmail').value;
  const financeRecruitingMode = document.getElementById('financeRecruitingMode').checked;
  const debugMode = document.getElementById('debugMode').checked;

  if (!apiKey && !anthropicApiKey) {
    showStatus('Please enter at least one API Key.', 'error');
    return;
  }

  if (modelSelect === 'custom' && !customModel) {
    showStatus('Please enter a custom model name.', 'error');
    return;
  }

  chrome.storage.local.set(
    {
      openAiApiKey: apiKey,
      anthropicApiKey: anthropicApiKey,
      userContext: userContext,
      model: model,
      tone: tone,
      exampleEmail: exampleEmail,
      financeRecruitingMode: financeRecruitingMode,
      debugMode: debugMode
    },
    () => {
      showStatus('Settings saved successfully!', 'success');
    }
  );
};

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
const restoreOptions = () => {
  chrome.storage.local.get(
    {
      openAiApiKey: '',
      anthropicApiKey: '',
      userContext: '',
      model: 'gpt-5.2',
      tone: 'Casual & Friendly',
      exampleEmail: '',
      financeRecruitingMode: false,
      debugMode: false
    },
    (items) => {
      document.getElementById('apiKey').value = items.openAiApiKey;
      if (items.anthropicApiKey) {
        document.getElementById('anthropicApiKey').value = items.anthropicApiKey;
      }
      document.getElementById('userContext').value = items.userContext;
      document.getElementById('tone').value = items.tone;
      document.getElementById('exampleEmail').value = items.exampleEmail;
      document.getElementById('financeRecruitingMode').checked = items.financeRecruitingMode;
      document.getElementById('debugMode').checked = items.debugMode;

      // Check if saved model is in the dropdown
      const modelSelect = document.getElementById('model');
      const options = Array.from(modelSelect.options).map(o => o.value);

      if (options.includes(items.model)) {
        modelSelect.value = items.model;
      } else {
        // It's a custom model
        modelSelect.value = 'custom';
        document.getElementById('customModel').value = items.model;
        document.getElementById('customModel').style.display = 'block';
      }
    }
  );
};

const showStatus = (msg, type) => {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.className = type;
  setTimeout(() => {
    status.textContent = '';
    status.className = '';
  }, 3000);
}

// Toggle custom model input visibility
const setupModelSelect = () => {
  const modelSelect = document.getElementById('model');
  const customInput = document.getElementById('customModel');

  modelSelect.addEventListener('change', () => {
    if (modelSelect.value === 'custom') {
      customInput.style.display = 'block';
      customInput.focus();
    } else {
      customInput.style.display = 'none';
    }
  });
};

const setupHelperModal = () => {
  const modal = document.getElementById('setupModal');
  const btn = document.getElementById('openSetupHelper');
  const span = document.getElementsByClassName('close')[0];
  const copyBtn = document.getElementById('copyPrompt');
  const promptText = document.getElementById('systemPrompt');

  btn.onclick = function (e) {
    e.preventDefault();
    modal.style.display = 'block';
  }

  span.onclick = function () {
    modal.style.display = 'none';
  }

  window.onclick = function (event) {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  }

  copyBtn.onclick = function () {
    promptText.select();
    promptText.setSelectionRange(0, 99999); // For mobile devices
    navigator.clipboard.writeText(promptText.value).then(() => {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.style.backgroundColor = '#059669';
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.backgroundColor = '#10b981';
      }, 2000);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();
  setupModelSelect();
  setupHelperModal();
});
document.getElementById('save').addEventListener('click', saveOptions);
