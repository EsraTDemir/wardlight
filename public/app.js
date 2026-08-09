const samples = {
  scam: `Subject: Congratulations - you have been shortlisted!

Hello, your resume was found on a job board and you are a perfect fit for our Remote Data Security Assistant position. Pay is $52/hr with weekly pay, no experience required.

The interview will be conducted via Telegram. To secure your slot, reply within 24 hours to trushield.hiring@gmail.com. After the interview you will receive a check to purchase your home-office equipment. A refundable $45 processing fee covers your background check. Please have your SSN, driver's license, and bank account details ready for direct deposit.`,
  clean: `Security Analyst

Example Security is hiring a Security Analyst in Pittsburgh, PA. The role supports incident response, security monitoring, and risk assessments. Candidates should apply through the company careers page. The listed salary range is $82,000-$108,000 plus benefits.`,
};

const scamRules = [
  {
    id: "SC-001",
    weight: 35,
    label: "Fee tied to being hired",
    pattern: /\b(refundable|processing|application|background(?:\s|-)?check)\s+(?:fee|cost)\b|\$\s?\d{1,4}\s+(?:processing|application|background)/i,
  },
  {
    id: "SC-002",
    weight: 35,
    label: "Equipment check or reimbursement scheme",
    pattern: /\b(?:check|cheque)\b[\s\S]{0,100}\b(?:equipment|vendor|reimburse|purchase)\b/i,
  },
  {
    id: "SC-003",
    weight: 25,
    label: "Recruiting from a personal email address",
    pattern: /\b[\w.+-]+@(?:gmail|yahoo|outlook|hotmail|icloud)\.com\b/i,
  },
  {
    id: "SC-004",
    weight: 25,
    label: "Interview moved to a chat app",
    pattern: /\b(?:telegram|whatsapp|signal|wire|skype chat)\b/i,
  },
  {
    id: "SC-005",
    weight: 30,
    label: "Identity or financial information requested before an offer",
    pattern: /\b(?:ssn|social security number|bank account|routing number|driver'?s license|photo id)\b/i,
  },
  {
    id: "SC-006",
    weight: 15,
    label: "Artificial deadline pressure",
    pattern: /\b(?:within|in)\s+(?:24|48)\s+hours?\b|\bimmediate(?:ly)?\s+start\b/i,
  },
];

const jobText = document.querySelector("#job-text");
const result = document.querySelector("#analysis-result");
const signalList = document.querySelector("#signal-list");
const riskScore = document.querySelector("#risk-score");
const riskSummary = document.querySelector("#risk-summary");
const interest = document.querySelector("#pilot-interest");

document.querySelector("#analyze-button").addEventListener("click", analyzeText);
document.querySelector("#clear-button").addEventListener("click", () => {
  jobText.value = "";
  result.hidden = true;
  jobText.focus();
});

document.querySelectorAll("[data-sample]").forEach((button) => {
  button.addEventListener("click", () => {
    jobText.value = samples[button.dataset.sample];
    analyzeText();
  });
});

document.querySelectorAll("[data-pilot-interest]").forEach((link) => {
  link.addEventListener("click", () => {
    interest.value = link.dataset.pilotInterest;
  });
});

function analyzeText() {
  const text = jobText.value.trim();
  const findings = scamRules.filter((rule) => rule.pattern.test(text));
  const score = Math.min(
    100,
    findings.reduce((total, rule) => total + rule.weight, 0),
  );

  result.hidden = false;
  signalList.replaceChildren();

  if (!text) {
    riskScore.textContent = "No text";
    riskSummary.textContent = "Paste a posting or recruiter message to run a local check.";
    return;
  }

  riskScore.textContent = `${score}/100`;
  riskSummary.textContent = findings.length
    ? `${findings.length} signal${findings.length === 1 ? "" : "s"} found. These patterns merit extra verification before you share personal information or pay anything.`
    : "No common scam signals were found in this text. This does not prove the posting is legitimate.";

  if (!findings.length) {
    const item = document.createElement("li");
    item.textContent = "No common scam patterns matched this text.";
    signalList.append(item);
    return;
  }

  for (const finding of findings) {
    const item = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = `${finding.id}: ${finding.label}`;
    const detail = document.createElement("span");
    detail.textContent = `Rule weight: +${finding.weight}`;
    item.append(label, detail);
    signalList.append(item);
  }
}

async function loadSummary() {
  const tracked = document.querySelector('[data-metric="tracked"]');
  const watch = document.querySelector('[data-metric="watch"]');
  const observed = document.querySelector('[data-metric="last-observed"]');
  const note = document.querySelector("#summary-note");

  try {
    const response = await fetch("https://api.wardlight.app/api/v1/public/summary");
    if (!response.ok) {
      throw new Error(`Summary request failed with ${response.status}`);
    }
    const summary = await response.json();
    tracked.textContent = number(summary.tracked_postings);
    watch.textContent = number(summary.verdicts.watch + summary.verdicts.likely_ghost + summary.verdicts.ghost);
    observed.textContent = formatDate(summary.last_observed_at);
    note.textContent = `Live aggregate data from GhostWatch. Latest score date: ${formatDate(summary.latest_score_date)}. Individual posting details are not exposed here.`;
  } catch {
    tracked.textContent = "Unavailable";
    watch.textContent = "Unavailable";
    observed.textContent = "Unavailable";
    note.textContent = "Live aggregate data is temporarily unavailable. The free pasted-text check still runs locally in this page.";
  }
}

function number(value) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatDate(value) {
  if (!value) {
    return "No data yet";
  }
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

loadSummary();
