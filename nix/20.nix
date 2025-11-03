with import <nixpkgs> {};
writeShellApplication {
  name = "20";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./20.sh;
}

