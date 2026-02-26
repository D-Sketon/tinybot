import type { BaseTool, ToolSchema } from "./base.ts";

/**
 * Stores tool instances and executes validated tool calls by name.
 */
export class ToolRegistry {
  private tools = new Map<string, BaseTool>();

  /**
   * Registers or replaces a tool by its name.
   */
  register(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Returns tool schemas for provider tool-call definitions.
   */
  getDefinitions(): ToolSchema[] {
    return Array.from(this.tools.values()).map((tool) => tool.schema);
  }

  /**
   * Validates and executes a tool call.
   */
  async execute(
    name: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`tool ${name} is not registered.`);
    }
    const errors = tool.validate(params);
    if (errors.length) {
      throw new Error(`Invalid arguments for ${name}: ${errors.join("; ")}`);
    }

    try {
      return await tool.execute(params);
    } catch (error) {
      throw new Error(`Tool ${name} failed: ${(error as Error).message}`);
    }
  }
}
