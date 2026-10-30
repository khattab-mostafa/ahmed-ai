
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const titles = {
  home: "الرئيسية",
  assistant: "المساعد الذكي",
  generator: "مولّد الأكواد",
  developer: "أدوات المطور",
  python: "أدوات Python",
  text: "أدوات النصوص",
  calculator: "الآلة الحاسبة",
  converter: "محوّل الوحدات",
  colors: "مزج الألوان",
  password: "كلمات المرور"
};

let chatHistory = [];
let calcExpression = "";
let toastTimer;
let codeBoxVoiceEnabled = true;

/* =========================================
   Notifications
========================================= */

function toast(message, isError = false) {
  const el = $("#toast");
  if (!el) return;

  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

/* =========================================
   Navigation
========================================= */

function showView(name) {
  if (!titles[name]) return;

  $$(".view").forEach(view => {
    view.classList.toggle("active", view.id === `view-${name}`);
  });

  $$(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  const breadcrumb = $("#breadcrumbTitle");
  if (breadcrumb) breadcrumb.textContent = titles[name];

  $("#sidebar")?.classList.remove("open");

  window.scrollTo({ top: 0, behavior: "smooth" });

  history.replaceState(
    null,
    "",
    name === "home" ? "/" : `/#${name}`
  );
}

document.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view]");

  if (viewButton) {
    event.preventDefault();
    showView(viewButton.dataset.view);
  }

  if (event.target.closest("[data-scroll-tools]")) {
    $("#toolGallery")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
});

$("#menuToggle")?.addEventListener("click", () => {
  $("#sidebar")?.classList.toggle("open");
});

window.addEventListener("hashchange", () => {
  const name = location.hash.slice(1);
  if (titles[name]) showView(name);
});

if (titles[location.hash.slice(1)]) {
  showView(location.hash.slice(1));
}

/* =========================================
   API Requests
========================================= */

async function postJSON(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "حدث خطأ. حاول مرة أخرى.");
  }

  return data;
}

/* =========================================
   CodeBox Pro - Voice Input
========================================= */

let codeBoxRecognition = null;
let codeBoxIsListening = false;

function setupVoiceInput() {
  const form = $("#chatForm");
  const input = $("#chatInput");
  const sendButton = $("#chatSend");

  if (!form || !input || !sendButton || $("#voiceInputButton")) return;

  const micButton = document.createElement("button");
  micButton.id = "voiceInputButton";
  micButton.type = "button";
  micButton.className = "btn btn-ghost";
  micButton.textContent = "🎤 تحدث";
  micButton.title = "إرسال رسالة باستخدام صوتك";

  sendButton.parentElement.insertBefore(micButton, sendButton);

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    micButton.addEventListener("click", () => {
      toast(
        "التعرف على الصوت غير مدعوم في هذا المتصفح. جرّب Chrome أو Edge.",
        true
      );
    });
    return;
  }

  codeBoxRecognition = new SpeechRecognition();
  codeBoxRecognition.lang = "ar-EG";
  codeBoxRecognition.continuous = false;
  codeBoxRecognition.interimResults = false;
  codeBoxRecognition.maxAlternatives = 1;

  micButton.addEventListener("click", () => {
    if (codeBoxIsListening) {
      codeBoxRecognition.stop();
      return;
    }

    try {
      codeBoxRecognition.start();
    } catch {
      toast("انتظر لحظة ثم جرّب الميكروفون مرة أخرى.", true);
    }
  });

  codeBoxRecognition.onstart = () => {
    codeBoxIsListening = true;
    micButton.textContent = "🔴 جاري الاستماع...";
    toast("اتكلم دلوقتي، أنا سامعك.");
  };

  codeBoxRecognition.onresult = event => {
    const transcript = event.results[0][0].transcript.trim();

    if (!transcript) {
      toast("لم أتمكن من فهم الكلام. جرّب مرة أخرى.", true);
      return;
    }

    input.value = transcript;
    input.focus();
    toast("تم تحويل صوتك إلى نص. راجع الرسالة واضغط إرسال.");
  };

  codeBoxRecognition.onerror = event => {
    const messages = {
      "not-allowed": "اسمح للمتصفح باستخدام الميكروفون من إعدادات الموقع.",
      "no-speech": "لم أسمع كلامًا. حاول مرة أخرى.",
      "network": "فيه مشكلة في الاتصال. تحقق من الإنترنت.",
      "audio-capture": "لم يتم العثور على ميكروفون متاح."
    };

    toast(
      messages[event.error] || "حدث خطأ في الميكروفون. حاول مرة أخرى.",
      true
    );
  };

  codeBoxRecognition.onend = () => {
    codeBoxIsListening = false;
    micButton.textContent = "🎤 تحدث";
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupVoiceInput);
} else {
  setupVoiceInput();
}

/* =========================================
   Voice Assistant
   تنظيف علامات التنسيق قبل النطق
========================================= */

function cleanTextForSpeech(text) {
  return String(text || "")
    // إزالة كتل الأكواد
    .replace(/```[\s\S]*?```/g, " تم عرض كود برمجي. ")
    // إزالة الصور والروابط مع الاحتفاظ بنص الرابط
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // إزالة عناوين Markdown
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    // إزالة علامات الاقتباس والتنسيق
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    // إزالة علامات القوائم
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // إزالة علامات الكود المتبقية
    .replace(/[`*_~#]/g, "")
    // تحسين المسافات
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function codeBoxSpeak(text) {
  if (!("speechSynthesis" in window)) {
    toast("المتصفح لا يدعم تشغيل الصوت.", true);
    return;
  }

  const cleanText = cleanTextForSpeech(text);

  if (!cleanText) {
    toast("مفيش نص صالح للنطق.", true);
    return;
  }

  if (!codeBoxVoiceEnabled) {
    toast("الصوت متوقف. فعّله أولًا.");
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(cleanText);
  const voices = window.speechSynthesis.getVoices();
  const isArabic = /[\u0600-\u06FF]/.test(cleanText);

  const voice = isArabic
    ? voices.find(v => v.lang.toLowerCase() === "ar-eg")
      || voices.find(v => v.lang.toLowerCase().startsWith("ar"))
    : voices.find(v => v.lang.toLowerCase().startsWith("en"));

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = isArabic ? "ar-EG" : "en-US";
  }

  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;

  window.speechSynthesis.speak(utterance);
}

function codeBoxStopVoice() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function codeBoxToggleVoice() {
  codeBoxVoiceEnabled = !codeBoxVoiceEnabled;

  if (!codeBoxVoiceEnabled) {
    codeBoxStopVoice();
  }

  toast(codeBoxVoiceEnabled ? "تم تفعيل الصوت." : "تم إيقاف الصوت.");

  return codeBoxVoiceEnabled;
}

/* =========================================
   Chat Messages
========================================= */

function appendMessage(role, text) {
  const row = document.createElement("div");
  row.className = `message ${
    role === "user" ? "user-message" : "assistant-message"
  }`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "M" : "✦";

  const body = document.createElement("div");
  body.className = "message-body";

  const title = document.createElement("strong");
  title.textContent = role === "user" ? "أنت" : "CodeBox AI";

  const paragraph = document.createElement("p");
  paragraph.textContent = text;

  body.append(title, paragraph);
  row.append(avatar, body);

  $("#chatMessages")?.append(row);

  const messages = $("#chatMessages");
  if (messages) messages.scrollTop = messages.scrollHeight;

  return paragraph;
}

/* =========================================
   Chat Form
   الرد لا يُقرأ تلقائيًا
========================================= */

$("#chatForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const input = $("#chatInput");
  const send = $("#chatSend");

  if (!input || !send) return;

  const message = input.value.trim();
  if (!message) return;

  appendMessage("user", message);
  input.value = "";

  const historyForRequest = chatHistory.slice(-8);
  chatHistory.push({ role: "user", content: message });

  send.disabled = true;
  send.textContent = "جاري الرد...";

  const pending = appendMessage("assistant", "جاري التفكير...");

  try {
    const data = await postJSON("/api/chat", {
      message,
      history: historyForRequest
    });

    const answer = data.answer || data.response || data.reply || "";

    if (!answer) {
      throw new Error("المساعد رجع ردًا فارغًا.");
    }

    pending.textContent = answer;

    chatHistory.push({
      role: "assistant",
      content: answer
    });

    // إنشاء أزرار الصوت والإيقاف بجوار الرد
    const messageBody = pending.parentElement;
    const controls = document.createElement("div");
    controls.className = "voice-controls";

    const speakButton = document.createElement("button");
    speakButton.type = "button";
    speakButton.className = "voice-speak-button";
    speakButton.textContent = "🔊 استمع للرد";
    speakButton.addEventListener("click", () => codeBoxSpeak(answer));

    const stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.className = "voice-stop-button";
    stopButton.textContent = "⏹ إيقاف الصوت";
    stopButton.addEventListener("click", codeBoxStopVoice);

    controls.append(speakButton, stopButton);
    messageBody.append(controls);

  } catch (error) {
    pending.textContent = error.message;
    toast(error.message, true);

  } finally {
    send.disabled = false;
    send.textContent = "إرسال ↗";
    input.focus();
  }
});

/* =========================================
   Clear Chat
========================================= */

$("#clearChat")?.addEventListener("click", () => {
  chatHistory = [];
  codeBoxStopVoice();

  const messages = $("#chatMessages");
  if (!messages) return;

  messages.replaceChildren();

  const row = document.createElement("div");
  row.className = "message assistant-message";

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = "✦";

  const body = document.createElement("div");
  body.className = "message-body";

  const title = document.createElement("strong");
  title.textContent = "CodeBox AI";

  const paragraph = document.createElement("p");
  paragraph.textContent =
    "بدأنا محادثة جديدة. اسألني عن البرمجة أو التكنولوجيا.";

  body.append(title, paragraph);
  row.append(avatar, body);
  messages.append(row);
});

/* =========================================
   Code Generator
========================================= */

$("#generatorForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const result = $("#generatorResult");
  const button = $("#generateButton");

  if (!result || !button) return;

  result.textContent = "جاري إنشاء الكود...";
  button.disabled = true;

  try {
    const data = await postJSON("/api/generate", {
      language: $("#codeLanguage")?.value,
      description: $("#codeDescription")?.value.trim()
    });

    result.textContent = data.answer || data.response || "لم يصل رد.";

  } catch (error) {
    result.textContent = error.message;
    toast(error.message, true);

  } finally {
    button.disabled = false;
  }
});

/* =========================================
   JSON Formatter
========================================= */

$("#formatJson")?.addEventListener("click", async () => {
  const status = $("#jsonStatus");
  if (!status) return;

  try {
    const data = await postJSON("/api/format-json", {
      text: $("#jsonInput")?.value || ""
    });

    $("#jsonOutput").value = data.result;
    status.textContent = "✓ JSON صحيح وتم تنسيقه.";
    status.classList.remove("error");

  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  }
});

$("#minifyJson")?.addEventListener("click", () => {
  const status = $("#jsonStatus");

  try {
    $("#jsonOutput").value = JSON.stringify(
      JSON.parse($("#jsonInput").value)
    );

    status.textContent = "✓ تم ضغط JSON.";
    status.classList.remove("error");

  } catch {
    status.textContent = "JSON غير صالح. راجع الأقواس والفواصل.";
    status.classList.add("error");
  }
});

$("#clearJson")?.addEventListener("click", () => {
  $("#jsonInput").value = "";
  $("#jsonOutput").value = "";
  $("#jsonStatus").textContent = "";
});

/* =========================================
   Python Code Inspector
========================================= */

$("#inspectPython")?.addEventListener("click", () => {
  const code = $("#pythonInput").value;
  const lines = code.split(/\r?\n/);
  const nonEmpty = lines.filter(line => line.trim());
  const comments = lines.filter(line => line.trim().startsWith("#"));

  const functions = (code.match(/^\s*def\s+\w+/gm) || []).length;
  const classes = (code.match(/^\s*class\s+\w+/gm) || []).length;
  const imports = (
    code.match(/^\s*(?:import\s+|from\s+\S+\s+import\s+)/gm) || []
  ).length;

  const result = $("#pythonResult");
  result.replaceChildren();

  const heading = document.createElement("strong");
  heading.textContent = code.trim() ? "ملخص الكود" : "مفيش كود للفحص";
  result.append(heading);

  if (!code.trim()) return;

  const list = document.createElement("ul");

  [
    `إجمالي الأسطر: ${lines.length}`,
    `الأسطر غير الفارغة: ${nonEmpty.length}`,
    `أسطر التعليقات: ${comments.length}`,
    `تعريفات الدوال الظاهرة: ${functions}`,
    `تعريفات الكلاسات الظاهرة: ${classes}`,
    `أسطر الاستيراد الظاهرة: ${imports}`
  ].forEach(text => {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  });

  result.append(list);

  const note = document.createElement("p");
  note.textContent =
    "هذا ملخص نصي أولي، وليس فحصًا نحويًا كاملًا أو تنفيذًا للكود.";

  result.append(note);
});

$("#clearPython")?.addEventListener("click", () => {
  $("#pythonInput").value = "";
  $("#pythonResult").textContent =
    "الصق كود Python واضغط فحص الكود.";
});

/* =========================================
   Text Tools
========================================= */

function updateTextStats() {
  const input = $("#textInput");
  if (!input) return;

  const text = input.value;

  $("#charCount").textContent = text.length;
  $("#wordCount").textContent = (text.trim().match(/\S+/g) || []).length;
  $("#lineCount").textContent =
    text.length ? text.split(/\r?\n/).length : 0;
}

$("#textInput")?.addEventListener("input", updateTextStats);

$("#uppercaseText")?.addEventListener("click", () => {
  $("#textInput").value = $("#textInput").value.toUpperCase();
  updateTextStats();
});

$("#lowercaseText")?.addEventListener("click", () => {
  $("#textInput").value = $("#textInput").value.toLowerCase();
  updateTextStats();
});

$("#copyText")?.addEventListener("click", () => {
  copyText($("#textInput").value);
});

$("#clearText")?.addEventListener("click", () => {
  $("#textInput").value = "";
  updateTextStats();
});

/* =========================================
   Copy Helpers
========================================= */

async function copyText(text) {
  if (!text) {
    toast("لا يوجد نص لنسخه.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    toast("تم النسخ.");

  } catch {
    toast("المتصفح منع النسخ التلقائي. حدّد النص وانسخه يدويًا.", true);
  }
}

$$("[data-copy-target]").forEach(button => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;

    copyText(
      target.value !== undefined ? target.value : target.innerText
    );
  });
});

$$("[data-copy-value]").forEach(button => {
  button.addEventListener("click", () => {
    const target = $("#" + button.dataset.copyValue);
    if (target) copyText(target.textContent);
  });
});

/* =========================================
   Calculator
========================================= */

const calcDisplay = $("#calcDisplay");

function updateCalcDisplay() {
  if (calcDisplay) {
    calcDisplay.textContent = calcExpression || "0";
  }
}

async function evaluateCalculator() {
  if (!calcExpression.trim()) return;

  try {
    const data = await postJSON("/api/calculate", {
      expression: calcExpression
    });

    calcExpression = String(data.result);
    $("#calcStatus").textContent = "";
    $("#calcStatus").classList.remove("error");

  } catch (error) {
    $("#calcStatus").textContent = error.message;
    $("#calcStatus").classList.add("error");
  }

  updateCalcDisplay();
}

$$("[data-calc]").forEach(button => {
  button.addEventListener("click", async () => {
    const value = button.dataset.calc;

    $("#calcStatus").textContent = "";
    $("#calcStatus").classList.remove("error");

    if (value === "clear") {
      calcExpression = "";
    } else if (value === "back") {
      calcExpression = calcExpression.slice(0, -1);
    } else if (value === "=") {
      await evaluateCalculator();
      return;
    } else if (/^[0-9.+\-*/()]$/.test(value)) {
      calcExpression += value;
    }

    updateCalcDisplay();
  });
});

/* =========================================
   Unit Converter
========================================= */

const unitData = {
  length: {
    units: {
      m: "متر (m)",
      km: "كيلومتر (km)",
      cm: "سنتيمتر (cm)",
      mm: "مليمتر (mm)",
      mi: "ميل (mi)",
      ft: "قدم (ft)",
      in: "بوصة (in)"
    },
    factors: {
      m: 1,
      km: 1000,
      cm: 0.01,
      mm: 0.001,
      mi: 1609.344,
      ft: 0.3048,
      in: 0.0254
    }
  },
  weight: {
    units: {
      kg: "كيلوجرام (kg)",
      g: "جرام (g)",
      mg: "مليجرام (mg)",
      lb: "رطل (lb)",
      oz: "أونصة (oz)"
    },
    factors: {
      kg: 1,
      g: 0.001,
      mg: 0.000001,
      lb: 0.45359237,
      oz: 0.028349523125
    }
  },
  temperature: {
    units: {
      C: "سيلزيوس (°C)",
      F: "فهرنهايت (°F)",
      K: "كلفن (K)"
    }
  }
};

function fillUnitOptions() {
  const categoryElement = $("#convertCategory");
  if (!categoryElement) return;

  const category = categoryElement.value;
  const units = unitData[category].units;

  ["#convertFrom", "#convertTo"].forEach(selector => {
    const select = $(selector);
    if (!select) return;

    select.replaceChildren();

    Object.entries(units).forEach(([key, label]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = label;
      select.append(option);
    });
  });

  $("#convertFrom").value =
    category === "temperature" ? "C" : Object.keys(units)[0];

  $("#convertTo").value =
    category === "temperature" ? "F" : Object.keys(units)[1];

  convertUnits();
}

function convertUnits() {
  const categoryElement = $("#convertCategory");
  if (!categoryElement) return;

  const category = categoryElement.value;
  const value = Number($("#convertValue").value);
  const from = $("#convertFrom").value;
  const to = $("#convertTo").value;

  if (!Number.isFinite(value)) {
    $("#convertResult").textContent = "أدخل قيمة صحيحة";
    return;
  }

  let result;

  if (category === "temperature") {
    const celsius =
      from === "C" ? value :
      from === "F" ? (value - 32) * 5 / 9 :
      value - 273.15;

    result =
      to === "C" ? celsius :
      to === "F" ? celsius * 9 / 5 + 32 :
      celsius + 273.15;

  } else {
    const factors = unitData[category].factors;
    result = value * factors[from] / factors[to];
  }

  $("#convertResult").textContent =
    `${Number(result.toPrecision(10))} ${to}`;
}

$("#convertCategory")?.addEventListener("change", fillUnitOptions);
$("#convertButton")?.addEventListener("click", convertUnits);
$("#convertValue")?.addEventListener("input", convertUnits);
$("#convertFrom")?.addEventListener("change", convertUnits);
$("#convertTo")?.addEventListener("change", convertUnits);

fillUnitOptions();

/* =========================================
   Color Mixer
========================================= */

function mixColors() {
  const colorOne = $("#colorOne");
  const colorTwo = $("#colorTwo");

  if (!colorOne || !colorTwo) return;

  const a = colorOne.value;
  const b = colorTwo.value;

  const toRGB = hex =>
    [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));

  const A = toRGB(a);
  const B = toRGB(b);

  const rgb = A.map((value, index) =>
    Math.round((value + B[index]) / 2)
  );

  const hex = "#" + rgb
    .map(value => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  $("#colorPreview").style.background =
    `linear-gradient(120deg, ${a}, ${b})`;

  $("#hexValue").textContent = hex;
  $("#rgbValue").textContent = `rgb(${rgb.join(", ")})`;
}

$("#colorOne")?.addEventListener("input", mixColors);
$("#colorTwo")?.addEventListener("input", mixColors);
mixColors();

/* =========================================
   Password Generator
========================================= */

$("#passwordLength")?.addEventListener("input", () => {
  $("#passwordLengthLabel").textContent = $("#passwordLength").value;
});

$("#makePassword")?.addEventListener("click", async () => {
  const button = $("#makePassword");
  if (!button) return;

  button.disabled = true;

  try {
    const data = await postJSON("/api/password", {
      length: Number($("#passwordLength").value),
      symbols: $("#passwordSymbols").checked
    });

    $("#passwordResult").textContent = data.password || "";

  } catch (error) {
    toast(error.message, true);

  } finally {
    button.disabled = false;
  }
});

$("#copyPassword")?.addEventListener("click", () => {
  copyText($("#passwordResult")?.textContent || "");
});
