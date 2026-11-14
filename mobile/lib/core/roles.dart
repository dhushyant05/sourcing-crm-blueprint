/// Source Easy roles and the visibility policy derived from QUESTIONS.md:
/// China staff see supplier details, India staff see customer details, each
/// office admin sees their own side, the super admin sees everything.
///
/// NOTE: this is client-side presentation filtering. Server-side separation is
/// approximated in Twenty with office tags + filtered views (see README).
enum Office { india, china }

enum Role {
  indiaStaff('INDIA_STAFF', Office.india, isAdmin: false),
  chinaStaff('CHINA_STAFF', Office.china, isAdmin: false),
  indiaAdmin('INDIA_ADMIN', Office.india, isAdmin: true),
  chinaAdmin('CHINA_ADMIN', Office.china, isAdmin: true),
  superAdmin('SUPER_ADMIN', null, isAdmin: true),
  marketplaceTeam('MARKETPLACE_TEAM', null, isAdmin: false);

  const Role(this.code, this.office, {required this.isAdmin});
  final String code;
  final Office? office; // null = both offices
  final bool isAdmin;

  static Role fromCode(String? code) =>
      Role.values.firstWhere((r) => r.code == code, orElse: () => Role.indiaStaff);

  String get label => switch (this) {
        Role.indiaStaff => 'India staff',
        Role.chinaStaff => 'China staff',
        Role.indiaAdmin => 'India admin',
        Role.chinaAdmin => 'China admin',
        Role.superAdmin => 'Super admin',
        Role.marketplaceTeam => 'Marketplace team',
      };
}

/// Role defaults, narrowed by the per-user grants the server returns from /api/me (`permissions`).
/// When [granted] is null (offline before the first /api/me) only the role-based rules apply.
class Permissions {
  const Permissions(this.role, [this.granted]);
  final Role role;
  final Set<String>? granted;

  /// Per-user feature permission (e.g. 'quotes.create'); true when unknown so offline mode keeps working.
  bool can(String key) => granted == null || role == Role.superAdmin || granted!.contains(key);

  bool get _india => role == Role.superAdmin || role.office == Office.india;
  bool get _china => role == Role.superAdmin || role.office == Office.china;

  // Customer side (India)
  bool get isSuperAdmin => role == Role.superAdmin;
  bool get canDeleteLead => can('leads.delete');
  bool get canBulkDeleteLeads => isSuperAdmin;
  bool get canSeeCustomerDetails => _india;
  bool get canCreateLead => _india;
  /// India-side customer directory (never China).
  bool get canSeeCustomers => _india && can('customers.view');
  /// Shipping requests (SH-…): India staff, China staff with orders.production, and the super admin — even without customers.view.
  /// China still never sees customer identity or prices (the server redacts the DTO).
  bool get canHandleShippingRequests => _india || (_china && can('orders.production'));
  bool get canEditCustomers => _india && can('customers.edit');
  bool get canRecordApproval => _india && can('quotes.customer');
  bool get canGenerateClientQuote => _india && can('quotes.customer');
  bool get canSeeClientPricing => _india && can('prices.inr');
  bool get canCreateOrder => _india && can('orders.create');
  bool get canEditPayment => _india && can('orders.payment');
  bool get canSetPriority => _india;

  // Supplier side (China)
  bool get canSeeSupplierDetails => _china && can('suppliers.view');
  bool get canSeeRawSupplierCost => _china;
  bool get canCreateSourcingRequest => _china;
  bool get canCreateQuotation => _china && can('quotes.create');
  bool get canEditShipping => can('orders.production');

  // Shared
  bool get canViewQuotes => can('quotes.view');
  bool get canViewShipping => true;
  bool get canChat => true;
  bool get canViewReports => can('reports.view');

  // Admin
  bool get canManageUsers => role.isAdmin && can('staff.manage');
  bool get canDownloadBackups => role == Role.superAdmin;

  bool get catalogOnly => role == Role.marketplaceTeam;
  bool get canEditCatalog => role == Role.superAdmin || can('catalog.edit');
  bool get canDeleteCatalog => role == Role.superAdmin || can('catalog.delete');
  bool get canPriceCatalog => role == Role.superAdmin || can('catalog.price');
  bool get canPublishCatalog => role == Role.superAdmin || can('catalog.publish');
  bool get canManageBanners => role == Role.superAdmin || can('catalog.banners');
}
