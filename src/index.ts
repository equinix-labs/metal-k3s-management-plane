import * as pulumi from "@pulumi/pulumi";
import * as tls from "@pulumi/tls";
import * as metal from "@pulumi/equinix-metal";

const config = new pulumi.Config();
const configAws = new pulumi.Config("aws");

const k3sControlPlane = new metal.Device("k3s-control-plane", {
  billingCycle: metal.BillingCycle.Hourly,
  hostname: "k3s-control-plane",
  operatingSystem: metal.OperatingSystem.Ubuntu2004,
  plan: metal.Plan.C3MediumX86,
  projectId: config.require("projectID"),
  description: "K3s Control Plane (Don't Delete)",
  metro: "am",
  userData: pulumi.interpolate`#!/usr/bin/env sh
# Ensure k3s API isn't available on public interface
export PRIVATE_IPv4=$(curl -s https://metadata.platformequinix.com/metadata | jq -r '.network.addresses | map(select(.public==false and .management==true)) | first | .address')
export INSTALL_K3S_EXEC="--bind-address $PRIVATE_IPv4 --advertise-address $PRIVATE_IPv4 --node-ip $PRIVATE_IPv4 --disable=traefik"

# Configure Litestream to backup and restore to S3
cat >/etc/litestream.yml <<END
access-key-id: ${configAws.requireSecret("accessKey")}
secret-access-key: ${configAws.requireSecret("secretKey")}

dbs:
  - path: /var/lib/rancher/k3s/server/db/state.db
    replicas:
      - url: s3://${config.require("bucketName")}/db

END

# Install Litestream
curl -o /tmp/litestream.deb -fsSL https://github.com/benbjohnson/litestream/releases/download/v0.3.4/litestream-v0.3.4-linux-amd64.deb
dpkg --force-confold -i /tmp/litestream.deb

# Install k3s
export INSTALL_K3S_SKIP_START=true
curl -sfL https://get.k3s.io | sh -

# Attempt a restore, if possible; don't fail if one doesn't exist
litestream restore -if-replica-exists /var/lib/rancher/k3s/server/db/state.db

# Start k3s
systemctl start k3s

# Start Litestream
systemctl enable litestream
systemctl start litestream

# GitOps all the rest
kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml apply -f https://github.com/fluxcd/flux2/releases/latest/download/install.yaml
kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml apply -f https://raw.githubusercontent.com/rawkode/equinix-metal-examples/main/pulumi-k3s/opt/flux/setup.yaml
`,
});
