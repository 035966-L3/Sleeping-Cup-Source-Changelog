with import <nixpkgs> {};
writeShellApplication {
  name = "26";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./26.sh;
}

