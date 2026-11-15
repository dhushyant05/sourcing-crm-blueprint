export type QuoteType = 'SOURCING' | 'SHIPPING';
export type FileKind = 'photos' | 'invoices' | 'packingLists';

export const emptyQuoteFiles = (): Record<FileKind, File[]> => ({ photos: [], invoices: [], packingLists: [] });

export const emptyQuoteFields = {
  name: '', phone: '', phoneCode: '+91', email: '', company: '', quantity: '', unit: 'pcs', message: '', requirement: '', requestLogin: false,
  goods: '', packages: '', weightKg: '', cbm: '', shipperName: '', shipperPhone: '', pickupCity: '', pickupAddress: '',
  destCity: '', destAddress: '', destPincode: '', mode: '', readyDate: '',
};

/** Photos, invoices and packing lists apply to both quote types, so switching type keeps them. */
export const filesAreTypeSpecific = false;

export function filesAfterTypeChange(current: Record<FileKind, File[]>): Record<FileKind, File[]> {
  return filesAreTypeSpecific ? emptyQuoteFiles() : current;
}
