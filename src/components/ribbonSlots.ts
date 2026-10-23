/** Extension point so another workstream can register ribbon panels without editing the drafting ribbon. */

export interface RibbonSlot {
  id: string;
  tab: 'home' | 'annotate' | 'civil';
  title: string;
  render: () => HTMLElement;
}

const slots: RibbonSlot[] = [];

export function registerRibbonSlot(slot: RibbonSlot): () => void {
  slots.push(slot);
  return () => {
    const index = slots.indexOf(slot);
    if (index >= 0) slots.splice(index, 1);
  };
}

export function ribbonSlots(tab: RibbonSlot['tab']): RibbonSlot[] {
  return slots.filter((slot) => slot.tab === tab);
}
