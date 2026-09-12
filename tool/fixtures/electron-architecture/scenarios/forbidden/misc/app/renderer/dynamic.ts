export async function load(name: string): Promise<void> {
  const mod = await import(name);
  void mod;
}