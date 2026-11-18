# Tailscale Serve and Funnel setup

Open **Set up Tailscale** from the provider’s setup prerequisites. Gozar
checks the CLI and the local daemon separately. Install a signed distribution
or ask the local administrator to start the service or grant operator access
when prompted. On a system that supports the guided installer, the offer pins
the upstream artifact and its SHA-256. [Tailscale packages](https://pkgs.tailscale.com/stable/)

Enter the intended sign-in email and MagicDNS suffix. An approved sign-in
action runs `tailscale up --timeout=12s --json` directly and checks
`tailscale status --json --peers=false` independently. The browser handoff
belongs to the operation that started it. After a Gozar process restart,
continue any open sign-in in the original browser window or the Tailscale
app, then refresh. Gozar checks the running node ID, its user record and
tailnet together. If the CLI cannot report the local user, update it and
refresh. [Tailscale status implementation](https://github.com/tailscale/tailscale/blob/v1.104.7/ipn/ipnlocal/local.go)

Follow any node approval, MagicDNS, HTTPS or Funnel policy action in the
offer. A tailnet administrator owns these settings. Gozar checks the exact
certificate hostname, capability and an eligible port using current daemon
and config readback. Use a second device on the tailnet for Serve, or a
client on the public internet for Funnel. The verifier must reach the exact
HTTPS origin and match the app challenge before publication.
[Tailscale Funnel requirements](https://tailscale.com/docs/features/tailscale-funnel)

**Account verification.** Use a disposable Linux VM in a test tailnet. Start
the service with `sudo systemctl start tailscaled` and complete the Gozar
browser action. If the daemon reports `NeedsMachineAuth`, open **Machines**,
verify the VM and intended user, and approve that exact machine. Run
`tailscale status --json --peers=false` to compare `Self.ID`, `Self.UserID`,
`User` and `CurrentTailnet` with what Gozar observed. For Funnel, grant the
node attribute to the disposable test node in **Access controls** if it is
needed. In Gozar approve the route and complete the independent client check.
Close the route and run `tailscale serve status --json` to confirm the exact
mapping disappeared while an existing test mapping remains. Remove the
disposable machine in **Machines** and revert any policy added for it. Gozar
route removal leaves membership, shared DNS and policy with the tailnet owner.
