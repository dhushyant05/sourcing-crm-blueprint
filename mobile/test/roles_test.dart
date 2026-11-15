import 'package:flutter_test/flutter_test.dart';
import 'package:source_easy/core/roles.dart';

void main() {
  test('India staff see customers, not suppliers or raw cost', () {
    const p = Permissions(Role.indiaStaff);
    expect(p.canSeeCustomerDetails, isTrue);
    expect(p.canSeeSupplierDetails, isFalse);
    expect(p.canSeeRawSupplierCost, isFalse);
  });

  test('China staff see suppliers, not customers or client pricing', () {
    const p = Permissions(Role.chinaStaff);
    expect(p.canSeeSupplierDetails, isTrue);
    expect(p.canSeeCustomerDetails, isFalse);
    expect(p.canSeeClientPricing, isFalse);
  });

  test('Office admins are scoped to their side', () {
    expect(const Permissions(Role.indiaAdmin).canSeeSupplierDetails, isFalse);
    expect(const Permissions(Role.chinaAdmin).canSeeCustomerDetails, isFalse);
    expect(const Permissions(Role.indiaAdmin).canDownloadBackups, isFalse);
  });

  test('Super admin sees everything incl. backups', () {
    const p = Permissions(Role.superAdmin);
    expect(p.canSeeCustomerDetails && p.canSeeSupplierDetails && p.canDownloadBackups, isTrue);
  });

  test('Unknown role code falls back to least-privileged India staff', () {
    expect(Role.fromCode('NOPE'), Role.indiaStaff);
    expect(Role.fromCode('SUPER_ADMIN'), Role.superAdmin);
  });

  test('Per-user grants from /api/me narrow the role defaults', () {
    const none = Permissions(Role.chinaStaff, {});
    expect(none.canCreateQuotation || none.canSeeSupplierDetails || none.canViewQuotes || none.canEditShipping, isFalse);
    const ship = Permissions(Role.indiaStaff, {'orders.production', 'quotes.view'});
    expect(ship.canEditShipping && ship.canViewQuotes, isTrue);
    expect(ship.canEditPayment || ship.canSeeClientPricing || ship.canGenerateClientQuote, isFalse);
    expect(const Permissions(Role.superAdmin, {}).canCreateQuotation, isTrue);
    expect(const Permissions(Role.indiaStaff).canEditPayment, isTrue); // offline before /api/me: role defaults
  });

  test('Marketplace Team and super admin can create categories and link suppliers; suppliers cannot price or publish', () {
    const mkt = Permissions(Role.marketplaceTeam, {'catalog.edit', 'catalog.publish'});
    expect(mkt.canManageCategories, isTrue);
    expect(mkt.canPromoteCatalog, isTrue);
    expect(mkt.canLinkCatalogSupplier, isTrue);
    expect(mkt.canPriceCatalog, isFalse);
    expect(mkt.canPublishCatalog, isTrue);
    const sa = Permissions(Role.superAdmin);
    expect(sa.canManageCategories && sa.canLinkCatalogSupplier && sa.canPriceCatalog && sa.canPublishCatalog && sa.canPromoteCatalog, isTrue);
    const supplier = Permissions(Role.supplier, {'catalog.edit'});
    expect(supplier.isSupplier, isTrue);
    expect(supplier.canEditCatalog, isTrue);
    expect(supplier.canPriceCatalog, isFalse);
    expect(supplier.canPublishCatalog, isFalse);
    expect(supplier.canManageCategories, isFalse);
    expect(supplier.canPromoteCatalog, isFalse);
    expect(supplier.canLinkCatalogSupplier, isFalse);
    expect(const Permissions(Role.indiaStaff).canLinkCatalogSupplier, isFalse);
    expect(const Permissions(Role.indiaStaff).canPromoteCatalog, isFalse);
    expect(const Permissions(Role.indiaAdmin).canPromoteCatalog, isFalse);
    expect(const Permissions(Role.chinaStaff).canLinkCatalogSupplier, isTrue);
  });
}
