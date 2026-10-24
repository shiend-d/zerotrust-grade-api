{
  description = "Development environment for the Zero Trust Sistem Nilai project";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      devShells = forAllSystems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [ nodejs_24 curl jq ];
            shellHook = ''
              echo "Zero Trust Sistem Nilai development shell"
              echo "Node: $(node --version) | npm: $(npm --version)"
              echo "Run npm install once, then npm start or npm run demo."
            '';
          };
        });
    };
}
