# ICN Dashboard CD 운영 준비

이 디렉터리는 GitHub Actions에서 검증된 `main` 커밋을 EC2에 배포하기 위한
운영 문서와 서버 측 스크립트를 담는다. 기존 Jenkins Job, API 수집 Job, RDS
스키마 및 `/etc/icn/backend.env`는 변경하지 않는다.

## 배포 구조

1. `Dashboard CI`가 `main` Push를 검사한다.
2. 성공한 CI의 동일 커밋 SHA와 `frontend-dist-<SHA>` Artifact만 CD가 사용한다.
3. GitHub OIDC로 단기 AWS 자격 증명을 발급받는다.
4. FastAPI 이미지를 GitHub Runner에서 빌드해 `<ECR repository>:<SHA>`로 Push한다.
5. 프론트 Artifact를 S3의 `dashboard/releases/<SHA>/frontend.tar.gz`에 업로드한다.
6. SSM Run Command가 EC2의 `/usr/local/sbin/icn-deploy`를 실행한다.
7. 새 백엔드를 비활성 포트(8002 또는 8003)에 실행하고 API를 검증한다.
8. 성공한 경우에만 프론트 심볼릭 링크와 Nginx upstream을 전환한다.
9. 전환 또는 최종 헬스체크가 실패하면 기존 프론트·Nginx·백엔드를 유지한다.

SSH 키와 22번 포트는 이 배포 흐름에 사용하지 않는다.

## 1. 최초 실행 승인 설정

GitHub 저장소의 **Settings → Environments → New environment**에서
`production`을 만든다.

- Required reviewers에 최초 배포 승인자를 지정한다.
- Prevent self-review가 필요하면 활성화한다.
- Deployment branches는 `main`만 허용한다.

이 보호 규칙이 있으면 CD가 자동으로 시작되어도 AWS 자격 증명을 발급받기 전에
승인을 기다린다. 첫 수동 배포가 성공한 뒤 완전 자동화를 원하면 Required reviewers를
제거할 수 있다. 브랜치 제한은 유지한다.

## 2. GitHub production Environment 변수

다음 값은 비밀번호가 아니므로 Environment **Variables**에 둔다.

| 이름 | 예시/설명 |
| --- | --- |
| `AWS_REGION` | EC2·ECR·S3·SSM이 위치한 리전, 예: `ap-northeast-2` |
| `AWS_DEPLOY_ROLE_ARN` | GitHub OIDC가 Assume할 IAM Role ARN |
| `ECR_REPOSITORY` | 미리 만든 ECR 저장소 이름, 예: `icn-dashboard-backend` |
| `DEPLOY_BUCKET` | 프론트 릴리스용 기존 또는 신규 S3 버킷 이름 |
| `EC2_INSTANCE_ID` | 대상 애플리케이션 EC2 인스턴스 ID |

OIDC를 사용하므로 AWS Access Key와 Secret Access Key를 GitHub Secrets에 만들지
않는다. 애플리케이션의 DB 값도 GitHub에 등록하지 않는다. DB 값은 기존
`/etc/icn/backend.env`에서만 읽는다.

## 3. GitHub OIDC IAM Role

GitHub OIDC Provider `token.actions.githubusercontent.com`이 계정에 있어야 한다.
Role 신뢰 정책은 저장소와 `production` Environment로 제한한다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:donacana/icn-my-station-db:environment:production"
        }
      }
    }
  ]
}
```

GitHub 배포 Role에는 다음 최소 권한이 필요하다. 실제 계정·리전·리소스 ID로
치환한다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrLogin",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "PushBackendImage",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/<ECR_REPOSITORY>"
    },
    {
      "Sid": "UploadFrontendRelease",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::<DEPLOY_BUCKET>/dashboard/releases/*"
    },
    {
      "Sid": "SendDeployCommand",
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ssm:<REGION>:*:document/AWS-RunShellScript",
        "arn:aws:ec2:<REGION>:<ACCOUNT_ID>:instance/<INSTANCE_ID>"
      ]
    },
    {
      "Sid": "ReadDeployCommandStatus",
      "Effect": "Allow",
      "Action": "ssm:GetCommandInvocation",
      "Resource": "*"
    }
  ]
}
```

## 4. EC2 Instance Profile과 네트워크

EC2에는 SSM Agent가 Online 상태인 Instance Profile이 필요하다.

- AWS 관리형 정책 `AmazonSSMManagedInstanceCore`
- 해당 ECR 저장소 Pull 권한
- `s3://<DEPLOY_BUCKET>/dashboard/releases/*`의 `s3:GetObject`

ECR Pull에는 다음 작업이 필요하다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrLogin",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "PullBackendImage",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/<ECR_REPOSITORY>"
    },
    {
      "Sid": "DownloadFrontendRelease",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<DEPLOY_BUCKET>/dashboard/releases/*"
    }
  ]
}
```

EC2가 SSM, ECR API/ECR DKR 및 S3에 HTTPS로 나갈 수 있어야 한다. 인터넷 Gateway,
NAT 또는 VPC Endpoint를 사용한다. GitHub Runner가 EC2에 직접 연결하지 않으므로
보안 그룹에 GitHub Actions용 SSH CIDR을 추가하지 않는다. 22번 포트는 관리자 고정
IP로 제한하거나 닫고 Session Manager를 사용한다.

## 5. EC2 1회 준비 작업

아래 명령은 운영자가 EC2에서 검토 후 한 번만 실행한다. 이 저장소의 Workflow는
인프라를 자동 변경하지 않는다.

필요 도구:

- Docker Engine
- Nginx
- AWS CLI v2
- SSM Agent
- `curl`, `flock`, `tar`

배포 스크립트 설치:

```bash
sudo install -o root -g root -m 0755 \
  infra/deploy/ec2-deploy.sh \
  /usr/local/sbin/icn-deploy
```

현재 프론트를 최초 릴리스로 이동하고 심볼릭 링크로 전환한다. 실행 전 Nginx의
`root /var/www/icn-dashboard;` 설정과 현재 페이지가 정상인지 확인한다.

```bash
sudo mkdir -p /var/www/icn-dashboard-releases
sudo mv /var/www/icn-dashboard /var/www/icn-dashboard-releases/bootstrap
sudo ln -s /var/www/icn-dashboard-releases/bootstrap /var/www/icn-dashboard
```

현재 운영 상태를 기록한다.

```bash
sudo install -d -o root -g root -m 0700 /var/lib/icn-dashboard-deploy
sudo tee /var/lib/icn-dashboard-deploy/current.env >/dev/null <<'EOF'
ACTIVE_PORT=8002
ACTIVE_CONTAINER=icn-backend-db-test
ACTIVE_SHA=bootstrap
FRONTEND_RELEASE=/var/www/icn-dashboard-releases/bootstrap
EOF
sudo chmod 600 /var/lib/icn-dashboard-deploy/current.env
```

EC2 환경에 리전을 설정한다. 공개 HTTPS 헬스체크 주소는 비밀정보가 아니다.

```bash
sudo tee /etc/icn/deploy.conf >/dev/null <<'EOF'
AWS_REGION=ap-northeast-2
PUBLIC_API_HEALTH_URL=https://<DOMAIN>/api/v1/dashboard/summary
EOF
sudo chmod 644 /etc/icn/deploy.conf
```

`/etc/icn/backend.env`는 현재처럼 root 소유·권한 600으로 유지하며 수정하지 않는다.
배포 전에 `DATA_MODE=db`인지 운영자가 값 자체를 로그에 출력하지 않는 방식으로
확인한다.

## 6. Nginx 전제 조건

`/etc/nginx/sites-available/icn-dashboard` 안의 `/api/`와 `/ws/` upstream은 문자열
`127.0.0.1:8002` 또는 `127.0.0.1:8003`을 사용해야 한다. 배포 스크립트는 현재 포트
문자열을 다음 포트로 바꾸고 `nginx -t` 후 reload한다.

프론트 root는 다음 경로를 계속 사용한다.

```nginx
root /var/www/icn-dashboard;
```

SPA 새로고침을 위해 `try_files $uri $uri/ /index.html;` 설정도 확인한다. WebSocket
location에는 Upgrade/Connection 헤더가 필요하다.

## 7. 최초 배포 전 점검

실제 배포 승인을 누르기 전에 다음을 확인한다.

1. `Dashboard CI`가 배포 대상 main SHA에서 성공했다.
2. SSM Fleet Manager에서 대상 인스턴스가 Online이다.
3. ECR 저장소와 S3 버킷이 존재한다.
4. EC2 Instance Profile로 ECR Pull과 S3 Get이 가능하다.
5. 8003 포트가 비어 있다.
6. Nginx가 현재 8002의 `icn-backend-db-test`를 가리킨다.
7. `/etc/icn/backend.env`의 소유자·권한이 root/600이다.
8. `/api/v1/dashboard/summary`가 현재 운영 환경에서 성공한다.
9. EC2 RAM·디스크 여유가 있다. 새 컨테이너 검증 중에는 기존·신규 컨테이너가
   동시에 실행되므로 약 2GB 환경에서는 Jenkins 빌드와 겹치지 않게 한다.

## 8. 롤백과 운영 특성

- 새 컨테이너는 기존 운영 컨테이너가 실행 중인 상태에서 검증한다.
- API 또는 공개 헬스체크 실패 시 Nginx와 프론트 링크를 이전 상태로 복원한다.
- 성공 후에도 이전 컨테이너는 삭제하지 않고 정지만 하므로 수동 복구가 가능하다.
- `flock`으로 동시 배포를 차단한다.
- GitHub Workflow는 승인 전과 SSM 호출 직전에 main 최신 SHA를 비교해 오래된
  커밋 배포를 차단한다.
- ECR 이미지 태그와 OCI revision label은 모두 40자리 Git SHA다.
- 릴리스 보관 개수와 ECR/S3 수명주기는 운영 확인 후 별도 정책으로 설정한다.

## 9. 실제 배포 없이 검증하는 방법

```bash
bash -n infra/deploy/ec2-deploy.sh
git diff --check
```

Workflow YAML 구조와 IAM ARN은 실제 AWS 계정 값을 넣기 전까지 정적 검증만 가능하다.
SSM, OIDC, ECR, S3, Nginx 전환 및 롤백은 production Environment 승인 전에는 실행되지
않는다.
