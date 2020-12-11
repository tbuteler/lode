---
home: true
navbar: false
sidebar: false
layout: Simple
pageClass: overview
title: A universal GUI for unit testing
---

<div class="hero text-center">
    <h1 class="f00-light mb-2">A universal GUI for unit&nbsp;testing</h1>
    <p class="col-md-8 mx-auto mb-1 f2-light">Lode is an open-source desktop application for visualizing and running automated tests with a unified interface across frameworks&nbsp;and&nbsp;languages.</p>
    <p class="col-md-8 mx-auto mb-4 f2-light">Supports <strong>PHPUnit</strong> and <strong>Jest</strong>, with more frameworks coming&nbsp;soon.</p>
    <Download />
    <div class="d-block width-fit mx-auto mb-8 mt-6">
        <img :src="$withBase('/macos-light-full.png')" class="full-screenshot">
    </div>
</div>

<div class="text-center mb-7">
    <p class="col-md-8 mx-auto mb-1 f2-light">Setup is easy, requires no additional dependencies and both local and remote environments are supported. <RouterLink to="/documentation/">See the documentation</RouterLink> to get started.</p>
</div>

<Feature
    slug="light-feature-1"
    title="Run tests selectively"
    description="Select which files or even individual tests to run, all with just a a click. And quickly focus on just the tests you need by filtering by outcome or keyword &mdash; handy for when you want to re-run only failed ones, or narrow down that test you were just refactoring."
/>

<Feature
    slug="light-feature-2"
    title="See results in real-time"
    description="Syntax-highlighted diffs and traces available as soon as a test fails &mdash; no more waiting for the full run to see what went wrong, or scanning through traces in the CLI. Every test result has its own pane and each trace frame is actionable, so you can copy its contents or open the affected files with just a few clicks."
    class="feature--right"
/>

<Mailchimp />