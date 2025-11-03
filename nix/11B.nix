with import <nixpkgs> {};
writeShellApplication {
  name = "11B";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./11B.sh;
}

