import { updateConfig, getConfigValue, listConfig } from "../utils/config";
import { style } from "../utils/visual-system";

const st = style();

export function configSetCommand(key: string, value: string): void {
  try {
    updateConfig(key, value);
    console.log(st.success(`✓ Set ${key} = ${value}`));
  } catch (error: any) {
    console.error(st.error(`Failed to set config: ${error.message}`));
    process.exit(1);
  }
}

export function configGetCommand(key: string): void {
  try {
    const value = getConfigValue(key);
    if (value) {
      console.log(value);
    } else {
      console.log(st.warning(`${key} is not set`));
    }
  } catch (error: any) {
    console.error(st.error(`Failed to get config: ${error.message}`));
    process.exit(1);
  }
}

export function configListCommand(): void {
  try {
    const config = listConfig();
    console.log(st.bold("\nConsilium Configuration:\n"));

    if (Object.keys(config).length === 0) {
      console.log(st.warning("No configuration set."));
      console.log(st.dim("\nSet config with:"));
      console.log(st.dim('  consilium config set apiKey "your-key"'));
      console.log(
        st.dim('  consilium config set apiUrl "https://api.myconsilium.xyz"\n'),
      );
      return;
    }

    for (const [key, value] of Object.entries(config)) {
      const display =
        key === "apiKey" && typeof value === "string" && value.length > 8
          ? `${value.slice(0, 8)}...${value.slice(-4)}`
          : value;
      console.log(`${st.brand(key)}: ${display}`);
    }
    console.log();
  } catch (error: any) {
    console.error(st.error(`Failed to list config: ${error.message}`));
    process.exit(1);
  }
}
