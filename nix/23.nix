with import <nixpkgs> {};
writeShellApplication {
  name = "23";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./23.sh;
}

