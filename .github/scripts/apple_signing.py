"""Signature App Store de l'appli iPhone Qafila, sans appareil enregistré ni certificat à garder
(même méthode que Pyramid PDF ; lancé par le travail « Qafila - Apple » du dépôt Pyramid, qui détient la clé API) :
   setup   → crée un certificat « Apple Distribution » + un profil App Store (API App Store Connect),
             écrit dist.p12 / dist.mobileprovision et donne le nom du profil (sortie GitHub « profile »)
   cleanup → supprime le profil et révoque le certificat (les versions déjà envoyées à Apple ne sont pas touchées)
   Variables : ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, BUNDLE_ID, WORK (dossier de travail)."""
import base64, json, os, subprocess, sys, time, urllib.request, urllib.error
import jwt

E = os.environ
WORK = E.get('WORK', '/tmp/signing'); os.makedirs(WORK, exist_ok=True)
STATE = os.path.join(WORK, 'state.json')


def api(method, path, body=None):
    tok = jwt.encode({'iss': E['ASC_ISSUER_ID'], 'iat': int(time.time()), 'exp': int(time.time()) + 1100, 'aud': 'appstoreconnect-v1'},
                     open(E['ASC_KEY_PATH']).read(), algorithm='ES256', headers={'kid': E['ASC_KEY_ID'], 'typ': 'JWT'})
    req = urllib.request.Request('https://api.appstoreconnect.apple.com' + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            d = r.read()
            return r.status, (json.loads(d) if d else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:800]


def sh(*a):
    subprocess.run(a, check=True)


def setup():
    key, csr = os.path.join(WORK, 'dist.key'), os.path.join(WORK, 'dist.csr')
    sh('openssl', 'genrsa', '-out', key, '2048')
    sh('openssl', 'req', '-new', '-key', key, '-subj', '/CN=Qafila CI/C=FR', '-out', csr)
    s, d = api('POST', '/v1/certificates', {'data': {'type': 'certificates', 'attributes': {'certificateType': 'DISTRIBUTION', 'csrContent': open(csr).read()}}})
    if s != 201:
        sys.exit(f'Certificat refusé ({s}) : {d}')
    cert_id = d['data']['id']
    open(os.path.join(WORK, 'dist.cer'), 'wb').write(base64.b64decode(d['data']['attributes']['certificateContent']))
    state = {'cert': cert_id}
    json.dump(state, open(STATE, 'w'))
    s, d = api('GET', f"/v1/bundleIds?filter[identifier]={E['BUNDLE_ID']}")
    found = [b for b in (d or {}).get('data', []) if b['attributes']['identifier'] == E['BUNDLE_ID']] if s == 200 else []
    if not found:
        sys.exit(f"Identifiant {E['BUNDLE_ID']} introuvable dans le compte Apple ({s})")
    pname = f'Qafila App Store CI {int(time.time())}'
    s, d = api('POST', '/v1/profiles', {'data': {'type': 'profiles', 'attributes': {'name': pname, 'profileType': 'IOS_APP_STORE'},
               'relationships': {'bundleId': {'data': {'type': 'bundleIds', 'id': found[0]['id']}},
                                 'certificates': {'data': [{'type': 'certificates', 'id': cert_id}]}}}})
    if s != 201:
        sys.exit(f'Profil refusé ({s}) : {d}')
    state['profile'] = d['data']['id']
    json.dump(state, open(STATE, 'w'))
    open(os.path.join(WORK, 'dist.mobileprovision'), 'wb').write(base64.b64decode(d['data']['attributes']['profileContent']))
    sh('openssl', 'x509', '-inform', 'DER', '-in', os.path.join(WORK, 'dist.cer'), '-out', os.path.join(WORK, 'dist.pem'))
    sh('openssl', 'pkcs12', '-export', '-inkey', key, '-in', os.path.join(WORK, 'dist.pem'), '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES',
       '-macalg', 'sha1', '-passout', 'pass:ci', '-out', os.path.join(WORK, 'dist.p12'))
    with open(E.get('GITHUB_OUTPUT', '/dev/null'), 'a') as f:
        f.write(f'profile={pname}\n')
    print('✅ Certificat de distribution + profil', pname)


def cleanup():
    if not os.path.exists(STATE):
        return
    st = json.load(open(STATE))
    if st.get('profile'):
        print('profil supprimé', api('DELETE', f"/v1/profiles/{st['profile']}")[0])
    if st.get('cert'):
        print('certificat révoqué', api('DELETE', f"/v1/certificates/{st['cert']}")[0])


{'setup': setup, 'cleanup': cleanup}[sys.argv[1]]()
