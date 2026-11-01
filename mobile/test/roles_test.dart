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
}
