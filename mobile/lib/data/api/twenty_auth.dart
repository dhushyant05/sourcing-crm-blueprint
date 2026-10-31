import 'twenty_client.dart';

/// Email/password sign-in against Twenty's auth mutations.
/// Mutation names follow Twenty v0.5x+/1.x; adjust here if the server version differs.
class TwentyAuth {
  TwentyAuth(this.client);
  final TwentyClient client;

  Future<String> signIn(String email, String password) async {
    final origin = client.baseUrl;
    final lt = await client.query(r'''
      mutation($email: String!, $password: String!, $origin: String!) {
        getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) {
          loginToken { token } } }''',
        variables: {'email': email, 'password': password, 'origin': origin}, endpoint: '/metadata');
    final loginToken = lt['getLoginTokenFromCredentials']['loginToken']['token'] as String;
    final at = await client.query(r'''
      mutation($loginToken: String!, $origin: String!) {
        getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) {
          tokens { accessOrWorkspaceAgnosticToken { token } } } }''',
        variables: {'loginToken': loginToken, 'origin': origin}, endpoint: '/metadata');
    return at['getAuthTokensFromLoginToken']['tokens']['accessOrWorkspaceAgnosticToken']['token'] as String;
  }

  Future<({String email, String name})> currentUser() async {
    final d = await client.query(
        '{ currentUser { email workspaceMember { name { firstName lastName } } } }',
        endpoint: '/metadata');
    final u = d['currentUser'] as Map<String, dynamic>;
    final n = (u['workspaceMember']?['name'] as Map?) ?? {};
    return (
      email: u['email'] as String,
      name: '${n['firstName'] ?? ''} ${n['lastName'] ?? ''}'.trim(),
    );
  }
}
