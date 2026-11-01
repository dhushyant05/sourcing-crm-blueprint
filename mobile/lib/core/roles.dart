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
  superAdmin('SUPER_ADMIN', null, isAdmin: true);

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
      };
}

class Permissions {
  const Permissions(this.role);
  final Role role;

  bool get _india => role.office == null || role.office == Office.india;
  bool get _china => role.office == null || role.office == Office.china;

  // Customer side (India)
  bool get canSeeCustomerDetails => _india;
  bool get canCreateLead => _india;
  bool get canRecordApproval => _india;
  bool get canGenerateClientQuote => _india;
  bool get canSeeClientPricing => _india;

  // Supplier side (China)
  bool get canSeeSupplierDetails => _china;
  bool get canSeeRawSupplierCost => _china;
  bool get canCreateSourcingRequest => _china;
  bool get canCreateQuotation => _china;
  bool get canEditShipping => _china;

  // Shared
  bool get canViewShipping => true;
  bool get canChat => true;

  // Admin
  bool get canSetExchangeRate => role == Role.superAdmin; // server enforces the same
  bool get canManageUsers => role.isAdmin;
  bool get canDownloadBackups => role == Role.superAdmin;

  /// Currencies the user may toggle between on a quotation.
  /// India sees INR (converted); China sees the raw quoted currencies.
  List<String> get quoteCurrencies => [
        if (canSeeRawSupplierCost) ...['CNY', 'USD'],
        if (canSeeClientPricing) 'INR',
      ];
}
