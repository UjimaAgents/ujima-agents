const MASCULINE_FIRST_NAMES = [
  "Aaron",
  "Adrian",
  "Aiden",
  "Andrew",
  "Asher",
  "Caleb",
  "Carter",
  "Cole",
  "Dylan",
  "Ethan",
  "Evan",
  "Felix",
  "Finn",
  "Gavin",
  "Henry",
  "Isaac",
  "Jack",
  "Jasper",
  "Jonah",
  "Leo",
  "Lucas",
  "Mason",
  "Noah",
  "Owen",
  "Riley",
  "Silas",
  "Theo",
  "Tyler",
  "Wes",
  "Wyatt",
] as const;

const FEMININE_FIRST_NAMES = [
  "Ava",
  "Bella",
  "Chloe",
  "Clara",
  "Daisy",
  "Ella",
  "Emma",
  "Evelyn",
  "Fiona",
  "Grace",
  "Hannah",
  "Ivy",
  "Julia",
  "Layla",
  "Lena",
  "Maya",
  "Naomi",
  "Nora",
  "Olivia",
  "Phoebe",
  "Quinn",
  "Ruby",
  "Sadie",
  "Sophie",
  "Stella",
  "Violet",
  "Willow",
  "Zara",
] as const;

const LAST_NAMES = [
  "Bennett",
  "Brooks",
  "Carter",
  "Cole",
  "Ellis",
  "Foster",
  "Gray",
  "Hayes",
  "Holt",
  "Hunter",
  "Jordan",
  "Lane",
  "Marshall",
  "Mason",
  "Mercer",
  "Parker",
  "Reed",
  "Rowan",
  "Sloan",
  "Stone",
  "Taylor",
  "Vale",
  "Walker",
  "Wells",
  "West",
] as const;

function pick(values: readonly string[]) {
  return values[Math.floor(Math.random() * values.length)];
}

function buildAgentNameSuggestions() {
  const suggestions = new Set<string>();

  while (suggestions.size < 250) {
    const firstName = Math.random() < 0.5 ? pick(MASCULINE_FIRST_NAMES) : pick(FEMININE_FIRST_NAMES);
    suggestions.add(`${firstName} ${pick(LAST_NAMES)}`);
  }

  return Array.from(suggestions);
}

export const AGENT_NAME_SUGGESTIONS = buildAgentNameSuggestions();

export function getSuggestedAgentName() {
  return AGENT_NAME_SUGGESTIONS[Math.floor(Math.random() * AGENT_NAME_SUGGESTIONS.length)] ?? "Alex Carter";
}
