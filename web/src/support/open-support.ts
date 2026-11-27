/** Open the public or portal customer support widget, optionally pre-filled with a product. */
export type SupportOpenDetail = {
  productId?: string;
  productSlug?: string;
  productTitle?: string;
  source?: string;
};

export function openSupportWidget(detail: SupportOpenDetail = {}) {
  window.dispatchEvent(new CustomEvent('se:support-open', { detail }));
}

export function openEnquiryForm() {
  window.dispatchEvent(new CustomEvent('se:open-enquiry'));
}
