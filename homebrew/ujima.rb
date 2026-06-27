# typed: true
# frozen_string_literal: true

# Ujima Agents — Homebrew formula
#
# Usage:
#   brew tap ujimaagents/tap
#   brew install ujima
#
# Or from the repo directly:
#   brew install --formula homebrew/ujima.rb

class Ujima < Formula
  desc "Framework for building Slack-like teams of AI agents"
  homepage "https://github.com/UjimaAgents/ujima-agents"
  license "MIT"

  version "0.0.51"

  on_macos do
    on_arm do
      url "https://github.com/UjimaAgents/ujima-agents/releases/download/v#{version}/ujima-#{version}-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_DARWIN_ARM64"

      def install
        bin.install "ujima"
        libexec.install Dir["*"]
        # Symlink the actual binary into bin
        (bin/"ujima").write_env_script libexec/"ujima", PATH: "#{libexec}/node:$PATH"
      end
    end

    on_intel do
      url "https://github.com/UjimaAgents/ujima-agents/releases/download/v#{version}/ujima-#{version}-darwin-x64.tar.gz"
      sha256 "PLACEHOLDER_DARWIN_X64"

      def install
        bin.install "ujima"
        libexec.install Dir["*"]
        (bin/"ujima").write_env_script libexec/"ujima", PATH: "#{libexec}/node:$PATH"
      end
    end
  end

  test do
    assert_match "ujima", shell_output("#{bin}/ujima --version")
    assert_match "start", shell_output("#{bin}/ujima --help")
  end
end
